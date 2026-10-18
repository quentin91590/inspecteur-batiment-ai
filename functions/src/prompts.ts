import type { GuideRequest, SchemaDefinition } from './types.js';

/** Référentiel complet (attributs + valeurs possibles) — pour l'analyse détaillée. */
export function describeSchemaFull(schema: SchemaDefinition): string {
  let out = 'RÉFÉRENTIEL TECHNIQUE OBLIGATOIRE :\n';
  for (const [cat, subCats] of Object.entries(schema)) {
    for (const [sub, attrs] of Object.entries(subCats)) {
      out += `\nOBJET : ${cat} / ${sub}\n`;
      for (const [attrName, values] of Object.entries(attrs)) {
        if (values.length === 1 && values[0].startsWith('Numeric:')) {
          const parts = values[0].replace('Numeric:', '').split(':');
          out += `   - Attribut "${attrName}" : Nombre entre ${parts[0]} et ${parts[parts.length - 1]}\n`;
        } else {
          out += `   - Attribut "${attrName}" : Choisir parmi [${values.join(', ')}]\n`;
        }
      }
    }
  }
  return out;
}

/** Référentiel compact (noms seulement) — pour le guidage, où la vitesse compte. */
export function describeSchemaCompact(schema: SchemaDefinition): string {
  const lines: string[] = [];
  for (const [cat, subCats] of Object.entries(schema)) {
    const subs = Object.entries(subCats).map(([sub, attrs]) => `${sub} (${Object.keys(attrs).join(', ')})`);
    lines.push(`- ${cat} : ${subs.join(' ; ')}`);
  }
  return lines.join('\n');
}

const ANALYSIS_RULES = `
Tu es un expert en inspection de bâtiment.
Ton rôle est d'identifier les ÉLÉMENTS (objets) présents sur la photo et de remplir leurs ATTRIBUTS techniques selon le référentiel ci-dessous.

RÈGLES D'OR :
1. IDENTIFICATION : trouve l'objet principal (ex : une fenêtre, un radiateur, une chaudière).
2. CLASSEMENT : associe-le à une catégorie et un élément (sous-catégorie) EXACTS du référentiel.
3. ATTRIBUTS : remplis les attributs définis dans le référentiel pour cet élément, avec les valeurs proposées.
   Si une plaque signalétique ou une étiquette est lisible, utilise-la (année, marque, puissance…).
4. VÉTUSTÉ (IMPORTANT) : estime l'état global de 0 à 100 (conditionScore).
   - > 90 : neuf / excellent état
   - 70-90 : bon état (usure normale)
   - 50-70 : état moyen (fonctionnel mais âgé ou usé)
   - < 50 : mauvais état (à remplacer ou réparer)
5. Si plusieurs éléments du référentiel sont visibles, renvoie un objet par élément ; isPrimarySubject = true pour le sujet principal.
6. Si l'élément n'est PAS dans le référentiel, utilise category = "Non catégorisé".
7. commentaire : constat technique bref et factuel (défauts visibles, points d'attention).

Réponds avec un objet JSON { "elements": [ ... ] }.
`;

export function analysisSystem(schema: SchemaDefinition): string {
  return `${ANALYSIS_RULES}\n${describeSchemaFull(schema)}`;
}

export function analyzeImageUser(note?: string, hint?: string): string {
  let text = `ANALYSE CETTE IMAGE DE BÂTIMENT.

INSTRUCTIONS :
1. Identifie l'élément visible le plus pertinent du référentiel.
2. Si plusieurs éléments sont visibles, génère un objet par élément.
3. Remplis les attributs strictement avec les valeurs du référentiel.
4. ESTIME LE SCORE DE VÉTUSTÉ (0-100) pour chaque élément détecté. C'est CRUCIAL.
5. Si l'élément n'est PAS dans le référentiel, utilise category = "Non catégorisé".`;
  if (hint && hint.trim()) {
    text += `\n\nPhoto prise pendant une visite guidée ; élément visé : « ${hint.trim()} » (indication, à vérifier sur l'image).`;
  }
  if (note && note.trim()) {
    text += `\n\nCe que l'inspecteur a dit en prenant la photo (à prendre en compte, ex : année, marque, défaut signalé) :\n« ${note.trim()} »`;
  }
  return text;
}

export function analyzeTextUser(text: string): string {
  return `ANALYSE CETTE NOTE VOCALE D'INSPECTION : « ${text} »

INSTRUCTIONS :
1. Extrais les éléments techniques mentionnés dans le texte.
2. Associe-les au référentiel.
3. Remplis les attributs s'ils sont mentionnés.
4. Estime le score de vétusté (0-100) d'après ce qui est dit (50 si rien n'est dit sur l'état).`;
}

export function summarizePrompt(comment: string, category: string, subCategory: string): string {
  return `Tu es un expert en pathologie du bâtiment.

CONTEXTE :
Élément : « ${subCategory} » (${category}).
NOTES : « ${comment} »

TÂCHE : reformuler ces notes en liste à puces Markdown, en français, de façon factuelle et concise.

RÈGLES STRICTES DE FORMATAGE :
1. DONNE UNIQUEMENT LA LISTE À PUCES.
2. INTERDIT : pas d'introduction ni de conclusion.`;
}

const GUIDE_RULES = `
Tu es le copilote d'un inspecteur en bâtiment qui filme une visite avec son téléphone.
Tu reçois une image de la caméra toutes les deux secondes environ. Ta réponse s'affiche à l'écran (pas de voix).
Ton rôle : dire, en UNE consigne courte, quoi faire ensuite pour relever les éléments du référentiel de la zone en cours.

RÈGLES :
1. instruction : une seule consigne, impérative, au vouvoiement, 12 mots maximum, concrète et physique.
   Exemples : « Approchez-vous de la plaque signalétique de la chaudière », « Montrez l'étiquette du boiler »,
   « Reculez pour cadrer toute la chaufferie », « Éclairez le tableau électrique », « Filmez les conduites sous le plafond ».
2. Priorité aux éléments listés « À relever ». Ne redemande pas un élément listé « Déjà capturé ».
3. capture = true quand un élément du référentiel est net et bien cadré, ou quand une plaque signalétique / étiquette est lisible.
   L'application prend alors une photo haute définition qui sera analysée en détail. Une seule capture par élément.
   Pendant une capture, la consigne peut être « Ne bougez plus » ou la suite de la visite.
4. target : l'élément visé par la consigne ou la capture, sous la forme « Élément — détail » (ex : « Boiler — plaque signalétique »).
5. seen : les éléments du référentiel clairement visibles sur l'image, avec la catégorie et l'élément EXACTS du référentiel.
6. sceneQuality : « sombre », « flou », « loin », « proche », « hors_sujet » ou « ok ».
   Si l'image est inexploitable, la consigne sert d'abord à corriger la prise de vue.
7. Si l'inspecteur parle (« Paroles »), tiens-en compte : il peut poser une question ou donner une information.
8. Quand tout est relevé dans la zone, dis-le dans la consigne et suggère une autre zone.
9. detail : précision facultative de 15 mots maximum (ce qu'il faut regarder, pourquoi), sinon chaîne vide.
10. Reste factuel : ne devine pas un élément que tu ne vois pas.

RÉFÉRENTIEL (catégorie : éléments (attributs)) :
`;

export function guideSystem(schema: SchemaDefinition): string {
  return `${GUIDE_RULES}${describeSchemaCompact(schema)}`;
}

export function guideUser(req: GuideRequest): string {
  const missing = req.missing.length ? req.missing.slice(0, 30).map(l => `- ${l}`).join('\n') : '- (rien : la zone est complète)';
  const inProgress = req.inProgress.length ? req.inProgress.slice(0, 15).map(l => `- ${l}`).join('\n') : '- (aucun)';
  let text = `Zone en cours : ${req.zone}

À relever :
${missing}

Déjà capturé (analyse en cours, ne pas redemander) :
${inProgress}`;
  if (req.lastInstruction) text += `\n\nDernière consigne affichée : « ${req.lastInstruction} »`;
  if (req.transcript && req.transcript.trim()) text += `\n\nParoles de l'inspecteur : « ${req.transcript.trim()} »`;
  text += `\n\nRegarde l'image et donne la prochaine consigne.`;
  return text;
}
