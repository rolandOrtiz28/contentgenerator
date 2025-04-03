function parsePerplexityPlainText(text) {
  const lines = text.split("\n").filter(line => line.trim());
  const result = {};

  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*\s]*/, "")      // remove list markers like "- " or "* "
      .replace(/\*\*/g, "")         // remove markdown bold
      .trim();

    const [rawKey, ...rest] = cleaned.split(":");
    const key = rawKey?.trim().toLowerCase(); // lowercase to standardize
    const value = rest.join(":").trim(); // handle values with colons

    if (!key || !value) continue;

    switch (key) {
      case "primarykeywords":
        result.suggestedPrimaryKeywords = value.split(",").map(v => v.trim());
        break;
      case "secondarykeywords":
        result.suggestedSecondaryKeywords = value.split(",").map(v => v.trim());
        break;
      case "keypoints":
        result.suggestedKeyPoints = value.split(",").map(v => v.trim());
        break;
      case "uniquebusinessgoal":
        result.suggestedUniqueBusinessGoal = value;
        break;
      case "specificchallenge":
        result.suggestedSpecificChallenge = value;
        break;
      case "personalanecdote":
        result.suggestedPersonalAnecdote = value;
        break;
      case "cta":
        result.suggestedCta = value;
        break;
      case "specificinstructions":
        result.suggestedSpecificInstructions = value;
        break;
      case "toph2s":
        result.suggestedTopH2s = value.split(",").map(v => v.trim());
        break;
      case "metadescriptions":
        result.suggestedMetaDescriptions = value.split(",").map(v => v.trim());
        break;
      case "snippetsummaries":
        result.suggestedSnippetSummaries = value.split(",").map(v => v.trim());
        break;
      case "contentgaps":
        result.suggestedContentGaps = value.split(",").map(v => v.trim());
        break;
      case "clusters":
        result.suggestedClusters = value.split(",").map(v => v.trim());
        break;
      case "snippetquestion":
        result.suggestedSnippetQuestion = value;
        break;
      case "snippetformat":
        result.suggestedSnippetFormat = value;
        break;
      case "stats":
        result.stats = value.split(";").map(pair => pair.trim());
        break;
      case "faqs":
        result.faqs = value.split(";").map(pair => pair.trim());
        break;
      case "entities":
        result.entities = value.split(";").map(pair => pair.trim());
        break;
      default:
        break;
    }
  }

  return result;
}


module.exports = { parsePerplexityPlainText };
