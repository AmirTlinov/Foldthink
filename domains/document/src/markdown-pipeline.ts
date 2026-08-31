import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const mathClassRule: [string, ...Array<string | RegExp>] = [
  "className",
  /^language-./u,
  "math-inline",
  "math-display",
];

const safeMathSchema: SanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      mathClassRule,
    ],
  },
};

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(() => rehypeSanitize(safeMathSchema))
  .use(() => rehypeKatex({
      trust: false,
      strict: "error",
      maxSize: 20,
      maxExpand: 1_000,
    }))
  .use(rehypeStringify);

export async function renderMarkdown(source: string): Promise<string> {
  return String(await markdownProcessor.process(source));
}
