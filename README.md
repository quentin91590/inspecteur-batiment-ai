# Inspecteur Bâtiment AI — V2

Application d'inspection de bâtiment : photos, notes vocales et **visite guidée en vidéo**. L'IA remplit le référentiel (éléments, attributs, vétusté) et génère les rapports PDF/Word.

**Application en ligne : https://quentin91590.github.io/inspecteur-batiment-ai/**

## Nouveautés de la V2

| | V1 | V2 |
|---|---|---|
| Clé d'IA | Dans le code de l'appli (lisible par tous) | Sur le serveur uniquement (fonction Firebase `ai`, à Zurich) |
| Modèle | Gemini 3 Flash imposé | Gemini 3.5 Flash-Lite par défaut (le plus rapide), autre modèle Gemini au choix dans l'appli ; Claude et Qwen prêts dans le code, désactivés pour l'instant |
| Vidéo | — | **Visite guidée** : on filme, les consignes s'affichent à l'écran, les photos utiles sont prises automatiquement |
| Hors réseau | File perdue à la fermeture | File conservée sur l'appareil, analysée au retour du réseau |
| Comparer les modèles | — | **Banc d'essai** : même photo, plusieurs modèles, temps et coût affichés |
| Mode invité | Appelait Gemini avec la clé | IA simulée (démo sans compte, sans coût) |

### Comment marche la visite guidée

1. On choisit la zone (une catégorie du référentiel, ou tout le bâtiment).
2. Toutes les ~2 s, **seulement si l'image est stable et a changé**, l'appli envoie une image réduite (768 px) avec :
   - la liste de ce qui manque encore dans la zone,
   - ce que l'inspecteur vient de dire (dictée du téléphone, gratuite),
   - les photos déjà prises et en cours d'analyse (pour ne pas les redemander).
3. Le modèle rapide renvoie une **consigne courte** (« Approchez-vous de la plaque de la chaudière ») et, quand un élément est bien cadré, demande une **photo HD**.
4. La photo HD (1280 px) part dans la file d'analyse habituelle, avec les paroles prononcées : c'est le modèle « analyse » qui remplit les attributs.
5. **Sans réseau** (chaufferie en sous-sol) : chaque nouvelle scène stable est photographiée et mise en file ; tout est analysé au retour du réseau. Rien n'est perdu même si l'appli est fermée.

Crédits consommés (modifiables dans `constants.ts`, `AI_COSTS`) : 4 par minute de guidage, 8 par photo analysée.

## Mise en service (une seule fois)

Tout se fait dans le navigateur.

1. **Clé Gemini payante** : sur https://aistudio.google.com/apikey, créer une clé dans le projet Google Cloud `inspectionbat`, puis activer la facturation de ce projet dans AI Studio (prépaiement de 5 $ minimum ; quand le crédit est épuisé, l'IA s'arrête, sans dépassement possible). Ne pas réutiliser la clé de la V1 : elle était visible dans le code de l'appli.
2. **Plan Blaze** sur le projet Firebase (déjà nécessaire pour le stockage des photos) ; créer une alerte de budget dans Google Cloud.
3. **Déploiement** : ouvrir https://shell.cloud.google.com avec le même compte Google et coller :
   ```bash
   git clone https://github.com/quentin91590/inspecteur-batiment-ai && cd inspecteur-batiment-ai && bash deploy.sh
   ```
   Le script installe ce qu'il faut, demande la clé Gemini (une seule fois), déploie la fonction `ai` et les règles Firestore, puis autorise `quentin91590.github.io` pour la connexion Google.
4. Ouvrir l'application, **se connecter avec Google** : le badge du modèle affiche « Gemini 3.5 Flash-Lite ».

Pour une mise à jour de la fonction plus tard : relancer `bash deploy.sh` dans Cloud Shell (après `git pull`).

L'application elle-même (GitHub Pages) se met à jour toute seule à chaque envoi sur `main`.

## Choisir les modèles

- **Dans l'appli** : bouton du modèle (à côté de « Assistant Intelligent ») → un modèle par usage (analyse photo, guidage vidéo, notes vocales) + banc d'essai.
- **Pour tous les utilisateurs** : document Firestore `config/ai` (console Firebase), relu toutes les 60 s :
  ```json
  {
    "defaults": {
      "analyze": "gemini:gemini-3.5-flash-lite",
      "guide": "gemini:gemini-3.5-flash-lite",
      "text": "gemini:gemini-3.5-flash-lite"
    },
    "limits": { "guide": 4000, "analyze": 800, "text": 400 },
    "allowClientModelChoice": true
  }
  ```
  Identifiants disponibles : `gemini:gemini-3.5-flash-lite` (défaut), `gemini:gemini-3.1-flash-lite`, `gemini:gemini-3-flash-preview`, `gemini:gemini-3.8-flash`.
- **Plus tard, Claude ou Qwen / Infomaniak** : le code est prêt (`functions/src/providers.ts`) ; il suffit de déclarer leur clé dans `functions/src/index.ts` (voir le commentaire en tête du fichier) et de redéployer.

`limits` = nombre d'appels par utilisateur et par jour. La consommation (appels, tokens, modèle) est enregistrée dans `usage/{uid}/days/{date}`.

## Développement

```bash
npm install
npm run demo          # appli en local avec IA simulée (aucune clé nécessaire)
npm run dev           # appli en local avec la vraie fonction déployée
npm run typecheck
cd functions && npm test   # 16 tests : forme exacte des requêtes envoyées aux modèles et lecture des réponses
```

Émulateur Firebase : `firebase emulators:start --only functions` puis `VITE_USE_EMULATORS=1 npm run dev`.

## Structure

```
App.tsx                      écran principal, file d'analyse
components/GuidedVisit.tsx   visite guidée (caméra, guidage, photos HD, hors réseau)
components/ModelSettingsModal.tsx  choix des modèles + banc d'essai
services/aiService.ts        appels à la fonction « ai » (+ IA simulée en mode invité)
services/localQueue.ts       file d'attente conservée sur l'appareil (IndexedDB)
utils/checklist.ts           ce qui manque dans le référentiel, par zone
functions/src/               fonction serveur : prompts, modèles, fournisseurs, quotas
```

## Limites connues

- **Dictée** : Chrome (Android, ordinateur) et Safari (iPhone) ; elle a besoin du réseau.
- **Lampe** : seulement si le navigateur la propose (Chrome Android).
- La première consigne peut prendre quelques secondes de plus (démarrage à froid du serveur). Pour l'éviter : `AI_MIN_INSTANCES=1` dans `functions/.env` (coût de quelques francs par mois).
