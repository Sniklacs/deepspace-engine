import { env, pipeline } from "@huggingface/transformers";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/tmp/modelroot/";
const t0 = Date.now();
try {
  console.log("building pipeline (cpu, q8)...");
  const pipe = await pipeline("translation", "unbound/m2m100-418m-q8", { dtype: "q8", device: "cpu" });
  console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const line = "¡Hola Hans! Soy Gibbletits. ¿Puedes ver el botón de traducir en este mensaje?";
  const out = await pipe(line, { src_lang: "es", tgt_lang: "en", max_new_tokens: 256 });
  const text = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text;
  console.log("RESULT:", JSON.stringify(text));
} catch (err) {
  console.log("ERROR name:", err?.name);
  console.log("ERROR message:", String(err?.message).slice(0, 300));
  console.log("ERROR stack:", String(err?.stack).split("\n").slice(0, 5).join(" | ").slice(0, 600));
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
