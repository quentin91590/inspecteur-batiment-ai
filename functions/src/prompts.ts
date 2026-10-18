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
Tu reçois une image de la caméra toutes les deux secondes environ. Ta réponse s'affiche à l'écran (pas de voix) :
une consigne courte, et un cadre qui met en surbrillance l'élément à regarder.

1. OÙ EST L'INSPECTEUR
- space : nomme l'espace visible en 1 à 3 mots (ex : « Chambre », « Séjour », « Couloir », « Cage d'escalier », « Hall d'entrée »,
  « Cuisine », « Salle de bain », « Chaufferie », « Local électrique », « Cave », « Parking souterrain », « Combles », « Façade », « Abords »).
  Reste cohérent avec « Espace actuel » si l'image montre le même lieu.

2. GUIDER LÀ OÙ IL EST (règle la plus importante)
- La consigne porte sur un élément visible ou très probablement présent DANS L'ESPACE ACTUEL.
  Repères par type d'espace :
  · Pièces (chambre, séjour, bureau) : revêtements sol / murs / plafond, fenêtres vues de l'intérieur (cadre, vitrage, protections solaires),
    radiateurs et conduites, bouches de ventilation, éclairage, prises et interrupteurs, menuiseries intérieures.
  · Cuisine, salle de bain, WC : appareils sanitaires, robinetterie, évacuations, boiler électrique, ventilation, revêtements.
  · Hall, couloirs, paliers, cage d'escalier : revêtements, escaliers, garde-corps, ascenseur, éclairage, éclairage de secours, extincteurs,
    détection incendie, tableau électrique d'étage, portes.
  · Chaufferie, sous-station : chaudière ou PAC (plaque signalétique), boiler, distribution et isolation des conduites, vases d'expansion,
    introduction d'eau, distribution d'eau chaude, compteurs.
  · Local électrique / technique : tableau principal, local BT, courant faible ; local de ventilation : monobloc, production de froid.
  · Caves, sous-sol, parking : maçonnerie, plafond isolé, pompe de relevage, évacuations, sprinkler, éclairage, portes et barrières.
  · Combles, toiture : charpente, structure, isolation de toiture.
  · Extérieur (façade, abords) : revêtement de façade, fissures, fenêtres vues de dehors, descentes d'eau pluviale, toiture visible,
    espaces verts et zones dures, parking, panneaux solaires.
- INTERDIT de demander d'aller dans un autre espace (dehors, autre étage, sous-sol, toiture…), sauf si :
  a) l'inspecteur demande l'espace suivant, ou b) tout ce qui est utile ici est déjà relevé (spaceDone = true).
  Alors propose UN espace voisin et logique : d'abord les pièces du même étage, puis l'étage suivant ; les locaux techniques
  quand on passe au sous-sol ; l'extérieur seulement au début ou à la fin de la visite. Jamais d'aller-retour intérieur / extérieur.
- Mode « Commencer ici » : ne demande jamais de rejoindre un point de départ ; commence par ce qui est devant la caméra.
- Mode « Parcours guidé » : suis l'étape en cours. Si aucun espace n'a encore été visité et que l'étape est l'extérieur,
  la première consigne place l'inspecteur (ex : « Placez-vous face à l'entrée principale, côté rue »).

3. NE PAS REFAIRE CE QUI EST FAIT (bâtiments avec beaucoup de pièces)
- « Déjà relevé » liste ce qui est documenté. Ne le redemande pas, SAUF s'il est différent ici (autre type de revêtement, autre modèle
  de radiateur, autre type de fenêtre) ou visiblement abîmé : dans ce cas, vise-le et déclenche une photo.
- Ne redemande pas ce qui est « Capturé, analyse en cours ».
- Ignore ce qui ne se voit pas (nombres d'étages, surfaces, documents).

4. LA CONSIGNE
- instruction : impérative, au vouvoiement, 12 mots maximum, concrète et physique (« Montrez le radiateur sous la fenêtre »,
  « Filmez le sol de la chambre », « Approchez-vous de la plaque de la chaudière », « Levez le téléphone vers le plafond »).
- detail : précision facultative de 15 mots maximum, sinon chaîne vide.
- target : l'élément visé, sous la forme « Élément — détail » (ex : « Radiateur — sous la fenêtre »).
  Garde la même cible que « Élément visé précédemment » tant qu'elle n'a pas été photographiée et qu'elle est dans cet espace.
- Si l'inspecteur parle (« Paroles »), tiens-en compte : question, information (année, marque…) ou demande de passer à la suite.

5. SURBRILLANCE
- targetBox : si l'élément visé est visible sur l'image, son cadre [ymin, xmin, ymax, xmax] en coordonnées normalisées de 0 à 1000
  (0,0 = coin haut gauche de l'image). Sinon [].
- targetDirection : « ici » si l'élément est visible ; sinon où il se trouve probablement par rapport à l'image
  (« gauche », « droite », « haut », « bas », « derriere ») ou « inconnu ».

6. PHOTO HAUTE DÉFINITION
- capture = true quand un élément du référentiel est net et bien cadré, quand une plaque signalétique / étiquette est lisible,
  ou quand un élément déjà relevé est différent ici ou abîmé. Une seule capture par élément et par espace.
- seen : les éléments du référentiel clairement visibles (catégorie et élément EXACTS du référentiel).
- sceneQuality : « sombre », « flou », « loin », « proche », « hors_sujet » ou « ok » ; si l'image est inexploitable,
  la consigne corrige d'abord la prise de vue (« Allumez la lampe », « Reculez d'un pas »).

7. FIN D'ESPACE
- spaceDone = true quand plus rien d'utile n'est à relever ici ; nextSpace = l'espace voisin conseillé. Sinon spaceDone = false
  et nextSpace = chaîne vide (sauf si l'inspecteur demande l'espace suivant).

RÉFÉRENTIEL (catégorie : éléments (attributs)) :
`;

export function guideSystem(schema: SchemaDefinition): string {
  return `${GUIDE_RULES}${describeSchemaCompact(schema)}`;
}

const list = (lines: string[] | undefined, max: number, empty: string) =>
  lines && lines.length ? lines.slice(0, max).map(l => `- ${l}`).join('\n') : `- ${empty}`;

export function guideUser(req: GuideRequest): string {
  const mode = req.mode === 'parcours' ? 'Parcours guidé' : 'Commencer ici';
  const theme = req.theme || req.zone || 'Tout le bâtiment';
  const lines: string[] = [];
  lines.push(`Mode : ${mode}`);
  if (req.mode === 'parcours' && req.stage) {
    lines.push(`Étape en cours : ${req.stage}${req.nextStage ? ` (étape suivante : ${req.nextStage})` : ' (dernière étape)'}`);
  }
  lines.push(`Thème : ${theme}`);
  lines.push(`Espace actuel (images précédentes) : ${req.currentSpace || 'pas encore identifié'}`);
  lines.push(`Espaces déjà parcourus : ${req.spacesVisited && req.spacesVisited.length ? req.spacesVisited.slice(-12).join(' → ') : 'aucun'}`);
  if (req.requestNextSpace) {
    lines.push(`\nL'INSPECTEUR A TERMINÉ CET ESPACE et demande où aller ensuite : indique l'espace voisin le plus logique (nextSpace) et comment s'y rendre.`);
  }
  lines.push(`\nÉléments encore à relever :\n${list(req.missing, 30, 'rien : tout est relevé')}`);
  lines.push(`\nDéjà relevé (ne pas redemander, sauf si différent ici ou abîmé) :\n${list(req.recorded, 45, 'rien pour l’instant')}`);
  lines.push(`\nCapturé, analyse en cours (ne pas redemander) :\n${list(req.inProgress, 15, 'rien')}`);
  if (req.lastTarget) lines.push(`\nÉlément visé précédemment : « ${req.lastTarget} »`);
  if (req.lastInstruction) lines.push(`Dernière consigne affichée : « ${req.lastInstruction} »`);
  if (req.transcript && req.transcript.trim()) lines.push(`Paroles de l'inspecteur : « ${req.transcript.trim()} »`);
  lines.push(`\nRegarde l'image et donne la prochaine consigne.`);
  return lines.join('\n');
}
