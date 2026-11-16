import { createInterface } from "node:readline/promises"; // read's what we type in the terminal
import process from "node:process"; // access to env_var
import { spawn } from "node:child_process"; // starts programs of the sys
import { load, tool } from "@crtrs/llm"; // load the model and describe what the tools do
import { z } from "zod"; // validates parameters that the model delivers
import { rejects } from "node:assert/strict";
import { urlProtocolOk } from "zod/v4/core";

const modelPath = process.env.KAISER_MODEL;

if (!modelPath) {
  console.error("KAISER_MODEL var is empty or wrong");
  process.exit(1)
}

// input output - terminal
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const system = `
  Eres Kaiser, un asistente local que responde en español.
  Usa las herramientas disponibles solo cuando hagan falta.
  Nunca afirmes que realizaste una acción si la herramienta no lo confirma.
  No ejecutes comandos de terminal ni intentes leer, escribir o borrar archivos
`;

// Starts an external program and returns a promise for its startup result.
// `command` is the executable name; `args` is an array of command-line arguments.
function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    // Start the child process without a shell, detached from this process,
    // and without connecting its standard input, output, or error streams.
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    // Reject the promise if Node.js cannot start the child process.
    child.once("error", reject);

    // Resolve once the child process has started.
    child.once("spawn", () => {
      // Let Node.js exit without waiting for the child process to finish.
      child.unref();
      resolve();
    });
  });
}

const tools = {
  get_time: tool({
    description: "Returns the current local date and time.",
    run: async () =>
      new Date().toLocaleString("es-ES", {
        dateStyle: "full",
        timeStyle: "short",
      }),
  }),

  open_url: tool({
    description: "Abre una página web HTTP o HTTPS en el navegador predeterminado.",
    params: z.object({
      url: z.string().min(1).max(2048),
    }),
    run: async ({ url: rawUrl }) => {
      const trimmedUrl = rawUrl.trim();
      const candidate = /^https?:\/\//i.test(trimmedUrl)
        ? trimmedUrl
        : `https://${trimmedUrl}`;

      let url;

      try {
        url = new URL(candidate);
      } catch {
        return "No se pudo abrir la página: la URL no es válida.";
      }

      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        return "No se pudo abrir la página: solo se permiten URLs HTTP o HTTPS válidas.";
      }

      try {
        await spawnDetached("xdg-open", [url.href]);
        return `He abierto ${url.href} en el navegador predeterminado.`;
      } catch (error) {
        return `No se pudo abrir la página: ${error.message}`;
      }
    },
  }),
};

let ai;

try {
  console.log("Cargando modelo local...");
  ai = await load(modelPath, { system });

  const chat = ai.session();
  console.log("Kaiser está listo. Escribe /salir para terminar.");

  while (true) {
    const text = (await rl.question("\nTú> ")).trim();

    if (!text) continue;
    if (text.toLowerCase() === "/salir") break;

    try {
      const reply = await chat.prompt(text, { tools });
      console.log(`\nKaiser> ${reply}`);
    } catch (error) {
      console.error(`Error al consultar el modelo: ${error.message}`);
    }
  }
} catch (error) {
  console.error(`No pude iniciar Kaiser: ${error.message}`);
} finally {
  rl.close();

  if (ai) {
    await ai.unload().catch((error) => {
      console.error(`Error al liberar el modelo: ${error.message}`);
    });
  }
}
