import * as fs from "fs";
import * as path from "path";
import {
  supportsCoverage,
  supportsTestRun,
  supportsVerification,
} from "../core/contracts";
import type {
  ArtifactSpec,
  CoverageTarget,
  EcosystemAdapter,
  ProjectModel,
} from "../core/contracts";
import {
  COVERAGE_STAGE_NAME,
  TEST_RUN_STAGE_NAME,
  buildCoverageDocument,
  presentCoverage,
  presentRepairProgress,
  presentRepairResult,
  presentTestRun,
  renderCoverageDocument,
  runCoverageStage,
  runTestStage,
  verificationStageName,
  verifyAndRepair,
  type RepairReply,
  type RepairRequest,
  type TestRunOutcome,
  type TokenUsage,
  type VerificationOutcome,
  type VerificationPresentation,
} from "../core/verification";
import { runChatFixer } from "../agents/chatFixer";
import { saveAgentOutput } from "../agents/agentOutputSaver";
import type {
  AgentStatus,
  Ask,
  CoverageReportFile,
  PipelineEvent,
} from "./events";
import type { GeneratedTest } from "./generate";

export interface CheckRequest {
  readonly adapter: EcosystemAdapter;
  /** La prueba ya escrita, con lo que hace falta para corregirla. */
  readonly test: GeneratedTest;
  readonly className: string;
  readonly methodName: string;
  readonly ask: Ask;
  /** Tokens gastados hasta ahora: la diferencia es lo que costó cada corrección. */
  readonly tokenTotals: () => TokenUsage;
  /** Plantilla del informe HTML de cobertura. */
  readonly coverageTemplate: string;
  readonly onEvent?: (event: PipelineEvent) => void;
}

export interface RunRequest {
  readonly adapter: EcosystemAdapter;
  readonly project: ProjectModel;
  readonly spec: ArtifactSpec;
  /** Estado de la última verificación: sin pasarla, la prueba no se ejecuta. */
  readonly verification: VerificationOutcome["status"];
  readonly coverageTarget: CoverageTarget;
  /** Plantilla del informe HTML de cobertura. */
  readonly coverageTemplate: string;
  readonly onEvent?: (event: PipelineEvent) => void;
}

/**
 * Verifica el artefacto que ya está en disco (OP-13) y, mientras la
 * verificación lo rechace con errores dentro de la prueba, se los pasa al
 * corrector y vuelve a verificar. Después ejecuta y mide la cobertura.
 *
 * Corre después de mostrar la prueba y no antes: la verificación puede tardar
 * segundos o minutos, y la prueba ya está escrita y se puede leer mientras
 * tanto. Si el adaptador no ofrece verificación, la etapa se informa como no
 * aplicable sin lanzar nada.
 *
 * No lanza: un fallo a mitad de camino se informa como verificación
 * interrumpida, porque la prueba ya está escrita.
 */
export async function checkGeneratedTest(request: CheckRequest): Promise<void> {
  const { adapter, test, ask } = request;
  const emit = request.onEvent ?? (() => undefined);
  const kind = adapter.capabilities.verification;
  const { project, spec } = test;
  const outputRoot = project.rootPath;
  const showVerification = (presentation: VerificationPresentation) =>
    emit({ kind: "verification", presentation });
  const notifyAgent = (agent: string, status: AgentStatus, detail?: string) =>
    emit({ kind: "agent", agent, status, detail });

  const fix = async ({
    cycle,
    code,
    feedback,
  }: RepairRequest): Promise<RepairReply> => {
    const before = request.tokenTotals();
    const fixResult = await runChatFixer(
      {
        profile: test.profile,
        testCode: code,
        assembledContext: test.assembledContext,
        userMessage: feedback,
        className: request.className,
        methodName: request.methodName,
        workspaceRoot: outputRoot,
        dumpDir: path.join("repair", `cycle-${cycle}`),
      },
      ask,
    );
    const after = request.tokenTotals();
    const usage = {
      inputTokens: after.inputTokens - before.inputTokens,
      outputTokens: after.outputTokens - before.outputTokens,
    };

    switch (fixResult.status) {
      case "FIXED":
        return {
          status: "fixed",
          code: fixResult.correctedCode,
          summary: fixResult.summary,
          usage,
        };
      case "INFO":
        return {
          status: "notFixed",
          reason: `respondió sin corregir: ${fixResult.answer}`,
          usage,
        };
      case "ERROR":
        return { status: "notFixed", reason: fixResult.message, usage };
    }
  };

  try {
    // Los volcados son de la última verificación, igual que los de los
    // agentes: sin borrar, un ciclo de una corrida anterior quedaría mezclado.
    // Dentro del try: si el borrado fallara, se informa como verificación
    // interrumpida en lugar de perderse sin mostrar nada.
    fs.rmSync(path.join(outputRoot, "AgentOutputs", "repair"), {
      recursive: true,
      force: true,
    });

    const result = await verifyAndRepair({
      adapter,
      project,
      spec,
      fix,
      onEvent: (event) => {
        const fixerAgent = `Auto Fixer #${event.cycle}`;
        switch (event.kind) {
          case "verifying":
            if (supportsVerification(adapter)) {
              emit({
                kind: "stageRunning",
                stage: "verification",
                stageName: verificationStageName(kind),
              });
            }
            break;
          case "fixing":
            showVerification(
              presentRepairProgress(
                kind,
                event.outcome,
                event.cycle,
                event.maxCycles,
              ),
            );
            notifyAgent(fixerAgent, "running");
            break;
          case "fixed":
            notifyAgent(
              fixerAgent,
              "done",
              event.summary ?? "Correcciones aplicadas",
            );
            emit({ kind: "testCodeUpdated", code: event.code });
            break;
          case "notFixed":
            notifyAgent(fixerAgent, "error", event.reason);
            break;
        }
      },
    });

    const { outcome, ...record } = result;
    saveAgentOutput(outputRoot, "verification", outcome);
    saveAgentOutput(outputRoot, "repair", {
      ...record,
      finalStatus: outcome.status,
    });
    showVerification(presentRepairResult(kind, result));
    emit({ kind: "verified", status: outcome.status });

    // ── OP-14 y OP-15: ejecución y cobertura, con la prueba ya verificada ──
    await runAndMeasure({
      adapter,
      project,
      spec,
      verification: outcome.status,
      coverageTarget: test.coverageTarget,
      coverageTemplate: request.coverageTemplate,
      onEvent: request.onEvent,
    });
  } catch (err: any) {
    // La prueba ya está escrita: un fallo aquí no invalida la generación.
    showVerification({
      stageName: verificationStageName(kind),
      status: "notRun",
      summary: `La verificación se interrumpió: ${err.message}`,
      remediation: "Volvé a intentar la verificación.",
      diagnostics: [],
    });
  }
}

/**
 * Ejecuta las pruebas del artefacto (OP-14) y después mide la cobertura con
 * los datos de esa misma corrida (OP-15). Quien llama tiene que impedir que
 * corra otra cosa sobre el proyecto mientras tanto: la ejecución abre el
 * mismo proyecto que la verificación.
 */
export async function runAndMeasure(request: RunRequest): Promise<void> {
  const { adapter, project, spec, verification, coverageTarget } = request;
  const emit = request.onEvent ?? (() => undefined);

  const willRun =
    supportsTestRun(adapter) &&
    (verification === "passed" || verification === "notApplicable");
  if (willRun) {
    emit({ kind: "stageRunning", stage: "testRun", stageName: TEST_RUN_STAGE_NAME });
  }

  const started = Date.now();
  const outcome = await runTestStage(
    adapter,
    project,
    spec,
    verification,
    coverageTarget,
  );
  // Fuera del tiempo de generación, como la verificación; se guarda aparte
  // para medir cuánto cuesta ejecutar.
  saveAgentOutput(project.rootPath, "test-run", {
    ...outcome,
    durationMs: Date.now() - started,
  });
  emit({ kind: "testRun", presentation: presentTestRun(outcome, spec.unitName) });

  await measure(request, outcome);
}

/**
 * Mide la cobertura de la ejecución que acaba de terminar. Guarda el
 * resultado en `AgentOutputs/coverage/` y, si se pudo medir, el informe HTML
 * al lado; si no, borra el de una medición anterior para que no queden
 * números viejos.
 */
async function measure(request: RunRequest, execution: TestRunOutcome) {
  const { adapter, project, spec, coverageTarget } = request;
  const emit = request.onEvent ?? (() => undefined);

  if (
    supportsCoverage(adapter) &&
    (execution.status === "passed" || execution.status === "failed")
  ) {
    emit({ kind: "stageRunning", stage: "coverage", stageName: COVERAGE_STAGE_NAME });
  }

  const started = Date.now();
  const outcome = await runCoverageStage(
    adapter,
    project,
    execution,
    coverageTarget,
  );
  const jsonPath = saveAgentOutput(project.rootPath, "coverage", {
    ...outcome,
    durationMs: Date.now() - started,
  });

  const reportPath = path.join(path.dirname(jsonPath), "coverage-report.html");
  fs.rmSync(reportPath, { force: true });
  let note: string | undefined;
  let report: CoverageReportFile | undefined;
  if (outcome.status === "measured") {
    try {
      const document = await buildCoverageDocument(
        project,
        outcome,
        coverageTarget,
        spec.unitName,
      );
      const template = fs.readFileSync(request.coverageTemplate, "utf8");
      fs.writeFileSync(
        reportPath,
        renderCoverageDocument(template, document),
        "utf8",
      );
      report = { path: reportPath, title: document.title };
    } catch (err: any) {
      // La medición vale igual: se muestra y el JSON quedó escrito.
      note = `No se pudo escribir el informe HTML: ${err.message}`;
    }
  }

  const presentation = presentCoverage(outcome, coverageTarget);
  emit({
    kind: "coverage",
    presentation: note ? { ...presentation, note } : presentation,
    report,
  });
}
