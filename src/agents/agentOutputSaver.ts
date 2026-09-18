import * as fs from "fs";
import * as path from "path";

/**
 * Guarda la salida estructurada de un agente.
 *
 * La raíz llega como parámetro en lugar de leerse del editor: la carpeta de
 * volcados tiene que ser la misma que usan los agentes, y esa es la raíz del
 * proyecto que descubrió el adaptador, no necesariamente la carpeta abierta.
 */
export function saveAgentOutput(
  outputRoot: string,
  agentName: string,
  output: unknown
): string {
  const outputDir = path.join(outputRoot, "AgentOutputs", agentName);

  fs.mkdirSync(outputDir, { recursive: true });

  const filePath = path.join(outputDir, `${agentName}-output.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf8");

  return filePath;
}
