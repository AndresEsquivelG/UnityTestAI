import * as fs from 'fs';
import * as path from 'path';
import type { PromptProfile } from '../core/contracts';
import { composeTemplate } from '../core/prompts';

const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

function loadTemplate(fileName: string): string {
  const filePath = path.join(PROMPTS_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Las ocho plantillas son neutras: exponen los puntos de extensión `{{...}}` que
 * rellena el perfil del adaptador (OP-08), y ninguna nombra una tecnología.
 *
 * El perfil se compone ANTES de sustituir los valores de la corrida. El orden
 * importa: al revés, un `{{algo}}` que viniera dentro del código de la persona
 * usuaria se interpretaría como un punto de extensión.
 */
function compose(fileName: string, profile: PromptProfile): string {
  return composeTemplate(loadTemplate(fileName), profile);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePlaceholders(
  template: string,
  vars: Record<string, string>
): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) =>
      result.replace(new RegExp(escapeRegex(key), "g"), value ?? ""),
    template
  );
}

/**
 * Builds the method-slicer prompt (methodSlicerPrompt.txt).
 * Agent 0: extracts a minimal code slice from the full source file.
 */
export function buildMethodSlicerPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  code: string
): string {
  return replacePlaceholders(compose("methodSlicerPrompt.txt", profile), {
    "<method-name>": methodName,
    "<class-name>":  className,
    "{code}":        code,
  });
}

/**
 * Builds the dependency-resolver prompt (dependencyResolverPrompt.txt).
 * Agent 1: receives the code slice and identifies missing external files.
 */
export function buildDependencyResolverPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  codeSlice: string,
  projectTree: string
): string {
  return replacePlaceholders(compose("dependencyResolverPrompt.txt", profile), {
    "<method-name>": methodName,
    "<class-name>":  className,
    "{code}":        codeSlice,
    "${projectTree}": projectTree || "(Project structure not available)",
  });
}

/**
 * Builds the context-builder prompt (contextBuilderPrompt.txt).
 * Agent 2: slices each dependency down to only the members the target method uses.
 */
export function buildContextBuilderPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  targetSlice: string,
  dependencyFiles: string
): string {
  return replacePlaceholders(compose("contextBuilderPrompt.txt", profile), {
    "<method-name>":    methodName,
    "<class-name>":     className,
    "{targetSlice}":    targetSlice,
    "{dependencyFiles}": dependencyFiles || "(No dependencies)",
  });
}

/**
 * Builds the code-analyzer prompt (codeAnalyzerPrompt.txt).
 * Agent 2.7: produces a decision table and branch analysis from the assembled context.
 */
export function buildCodeAnalyzerPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  assembledContext: string
): string {
  return replacePlaceholders(compose("codeAnalyzerPrompt.txt", profile), {
    "<method-name>":      methodName,
    "<class-name>":       className,
    "{assembledContext}": assembledContext,
  });
}

/**
 * Builds the context-validator prompt (contextValidatorPrompt.txt).
 * Agent 2.5: verifies the assembled context has everything needed for test generation.
 */
export function buildContextValidatorPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  assembledContext: string,
  fullContext: boolean = false
): string {
  const fullContextNote = fullContext
    ? `\nCONTEXT FORMAT — IMPORTANT:
The context is organized into sections with \`// ── TARGET: ... ──\` and \`// ── DEPENDENCY: <file> ──\` headers. Each DEPENDENCY section may contain EITHER:
  (a) a minimal slice with only the members referenced by the target method, OR
  (b) the COMPLETE source of the dependency file (full-context mode).
Both forms are VALID. When a section contains a full file, treat the extra members as normal — this is NOT a problem and you must NOT trim, shorten, or "optimize" it. Your job is only to confirm completeness, never to reduce.\n`
    : "";

  return replacePlaceholders(compose("contextValidatorPrompt.txt", profile), {
    "<method-name>":      methodName,
    "<class-name>":       className,
    "{assembledContext}": assembledContext,
    "{fullContextNote}":  fullContextNote,
  });
}

/**
 * Builds the test-generator prompt (testGeneratorPrompt.txt).
 * Agent 3: generates the tests from the assembled context.
 * Optionally injects a pre-computed code analysis block.
 */
export function buildTestGeneratorPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  assembledContext: string,
  codeAnalysis?: string
): string {
  const analysisBlock = codeAnalysis
    ? `━━ PRE-COMPUTED CODE ANALYSIS (Agent 2.7) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nVerify this analysis against the context. If correct, use it directly for STEP 0 and STEP 1.\n\n${codeAnalysis}\n\n`
    : "";

  return replacePlaceholders(compose("testGeneratorPrompt.txt", profile), {
    "<method-name>":      methodName,
    "<class-name>":       className,
    "{assembledContext}": assembledContext,
    "{codeAnalysis}":     analysisBlock,
  });
}

/**
 * Builds the test-validator prompt (testValidatorPrompt.txt).
 * Agent 3.5: verifies the generated test unit for structure and coverage.
 */
export function buildTestValidatorPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  assembledContext: string,
  testCode: string
): string {
  return replacePlaceholders(compose("testValidatorPrompt.txt", profile), {
    "<method-name>":      methodName,
    "<class-name>":       className,
    "{assembledContext}": assembledContext,
    "{testCode}":         testCode,
  });
}

/**
 * Builds the chat-fixer prompt (chatFixerPrompt.txt).
 * Chat Fixer: fixes errors in generated tests or answers questions, given full test + context.
 */
export function buildChatFixerPrompt(
  profile: PromptProfile,
  methodName: string,
  className: string,
  assembledContext: string,
  testCode: string,
  userMessage: string
): string {
  return replacePlaceholders(compose("chatFixerPrompt.txt", profile), {
    "<method-name>":      methodName,
    "<class-name>":       className,
    "{assembledContext}": assembledContext,
    "{testCode}":         testCode,
    "{userMessage}":      userMessage,
  });
}
