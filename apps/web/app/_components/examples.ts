export type ExampleInspection = {
  id: string;
  title: string;
  description: string;
  reference: { url: string; filename: string; mimeType: string };
  targets: { url: string; filename: string; mimeType: string }[];
  source: string;
};

export const EXAMPLES: ExampleInspection[] = [
  {
    id: "crack",
    title: "Pavement crack",
    description: "Hairline crack along the surface, branching or straight.",
    reference: {
      url: "/examples/crack/reference.jpg",
      filename: "reference.jpg",
      mimeType: "image/jpeg",
    },
    targets: [1, 2, 3, 4, 5].map((n) => {
      const filename = `target-0${n}.jpg`;
      return { url: `/examples/crack/${filename}`, filename, mimeType: "image/jpeg" };
    }),
    source: "SDNET2018 via simo-bat/Crack_detection",
  },
];

export function getExample(id: string): ExampleInspection | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
