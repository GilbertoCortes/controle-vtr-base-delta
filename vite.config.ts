import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { pathToFileURL } from "node:url";

export default defineConfig({
  plugins: [
    {
      name: "pdfkit-worker",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith("/pdfkit/js/pdfkit.node.mjs")) return;

        // workerd does not provide import.meta.url; resolve PDFKit's asset base at build time.
        const imports: string[] = [];
        const transformed = code
          .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(id).href))
          .replace(/require\$1\('#standard-fonts\/(\w+)'\)/g, (_, font: string) => {
            const name = `pdfkitFont${font}`;
            imports.push(`import ${name} from "pdfkit/standard-fonts/${font}";`);
            return name;
          });
        return {
          code: `${imports.join("\n")}\n${transformed}`,
          map: null,
        };
      },
    },
    vinext({
      images: { optimizer: imagesOptimizer() },
      cache: {
        data: kvDataAdapter(),
      },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});