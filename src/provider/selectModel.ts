import type { AvailableModel } from "./anthropic.js";

type ReadLine = (prompt: string) => Promise<string>;

export async function selectModel(models: AvailableModel[], readLine: ReadLine): Promise<AvailableModel> {
  if (models.length === 0) throw new Error("Anthropic returned no models available to this API key.");
  console.log("\nModels available:\n");
  models.forEach((model, index) => console.log(`${index + 1}. ${model.displayName} (${model.id})`));
  while (true) {
    const answer = (await readLine("select model number> ")).trim();
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && models[index]) return models[index];
    console.log(`Enter a number from 1 to ${models.length}.`);
  }
}
