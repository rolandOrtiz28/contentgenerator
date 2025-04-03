function fallbackManualParse(text) {
    const lines = text.split("\n").map((line) => line.trim());
    const suggestions = {};
  
    for (const line of lines) {
      const [key, value] = line.split(": ").map((part) => part.trim());
      if (!key || !value) continue;
  
      switch (key.toLowerCase()) {
        case "primarykeywords":
          suggestions.primaryKeywords = value.split(",").map((kw) => kw.trim());
          break;
        case "secondarykeywords":
          suggestions.secondaryKeywords = value.split(",").map((kw) => kw.trim());
          break;
        case "keypoints":
          suggestions.keyPoints = value.split(",").map((kp) => kp.trim());
          break;
        case "uniquebusinessgoal":
          suggestions.uniqueBusinessGoal = value;
          break;
        case "specificchallenge":
          suggestions.specificChallenge = value;
          break;
        case "personalanecdote":
          suggestions.personalAnecdote = value;
          break;
        case "cta":
          suggestions.cta = value;
          break;
        case "specificinstructions":
          suggestions.specificInstructions = value;
          break;
        case "toph2s":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.topH2s = value;
          break;
        case "metadescriptions":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.metaDescriptions = value;
          break;
        case "snippetsummaries":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.snippetSummaries = value;
          break;
        case "contentgaps":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.contentGaps = value;
          break;
        case "stats":
          suggestions.stats = Object.fromEntries(
            value.split(";").map((stat) => {
              const [fact, source] = stat.split("-").map((s) => s.trim());
              return [fact, source];
            })
          );
          break;
        case "faqs":
          suggestions.faqs = Object.fromEntries(
            value.split(";").map((faq) => {
              const [q, a] = faq.split("|").map((s) => s.trim());
              return [q, a];
            })
          );
          break;
        case "snippetquestion":
          suggestions.snippetData = suggestions.snippetData || {};
          suggestions.snippetData.question = value;
          break;
        case "snippetformat":
          suggestions.snippetData = suggestions.snippetData || {};
          suggestions.snippetData.format = value;
          break;
        case "clusters":
          suggestions.clusters = Object.fromEntries(
            value.split(",").map((cluster) => [cluster.trim(), ""])
          );
          break;
        case "entities":
          suggestions.entities = Object.fromEntries(
            value.split(";").map((entity) => {
              const [name, desc] = entity.split("|").map((s) => s.trim());
              return [name, desc];
            })
          );
          break;
      }
    }
  
    return suggestions;
  }
  