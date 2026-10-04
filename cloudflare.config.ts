import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "controle-vtr-base-delta",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-04",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      VINEXT_KV_CACHE: bindings.kv(),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(
        process.env.NEXT_PUBLIC_SUPABASE_URL!
      ),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
      SUPABASE_SECRET_KEY: bindings.secret(),
    },
  }),
});