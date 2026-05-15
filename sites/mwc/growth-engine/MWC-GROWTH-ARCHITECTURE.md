# MWC Growth Architecture

## Objectif
Donner à MWC une base opérable dans l’espace Hermes pour :
- mesurer l’origine du trafic et l’intention d’achat
- capter des leads même sans backend CRM branché
- générer des hooks / scripts / captions vidéo réutilisables
- préparer un agent léger qui produit un pack growth hebdo

## 1. Couche storefront
### Fichiers
- `index.html`
- `pages/checkout.html`
- `assets/app.js`
- `assets/store-config.js`
- `assets/runtime-config.js`
- `assets/styles.css`

### Responsabilités
- capture UTM / referrer / first-touch / last-touch
- push analytics dans `dataLayer`
- compatibilité optionnelle `gtag` / `fbq`
- capture lead via formulaire homepage
- fallback lead par `mailto:` si aucun webhook n’est branché
- passage checkout avec attribution transmise dans la query string

## 2. Couche configuration acquisition
### `assets/runtime-config.js`
Permet d’injecter sans refactor :
- `analytics.gaMeasurementId`
- `analytics.metaPixelId`
- `analytics.debug`
- `leadCapture.webhookUrl`
- `leadCapture.supportEmailFallback`
- `checkoutUrl`

### `growth-engine/config/products.json`
Source éditable pour :
- angles marketing
- hooks
- bénéfices
- objections
- audiences
- notes média
- profils de canaux

## 3. Couche content engine
### `content-engine/generate_content_pack.py`
Entrées : produit + plateforme + volume.
Sorties : pack JSON contenant :
- hook
- caption
- script
- beats de démonstration
- overlay lines
- voiceover

## 4. Couche vidéo / ops
### `video-pipeline/generate_video_assets.py`
À partir d’un content pack :
- génère un `manifest.json`
- génère des sous-titres `.srt`
- prépare une base de montage vertical 9:16

### `growth-ops/`
- `weekly_plan_template.md`
- `campaign-register.csv`
- `channel-playbooks.md`

But : garder une discipline opératoire simple et visible.

## 5. Couche agent légère
### `agent/run_mwc_growth_agent.py`
Génère un pack hebdo avec priorités :
- produit star d’abord
- recyclage cross-canal
- Snapchat validé manuellement en complément

### `agent/MWC_AGENT_PLAYBOOK.md`
Règles d’utilisation :
- l’agent prépare, il ne publie pas automatiquement sur Snapchat
- validation humaine avant diffusion
- Snapchat = canal complémentaire, pas pilier unique

## 6. Positionnement Snapchat
MWC peut utiliser Snapchat pour la visibilité, mais l’architecture actuelle reste volontairement prudente :
- génération de scripts / hooks / sous-titres : oui
- préparation de vidéos et variantes : oui
- publication automatique native Snapchat : non implémentée
- diffusion recommandée : humaine ou semi-assistée

## 7. Lecture business
Le meilleur montage actuel pour MWC est :
1. produit star très démonstratif
2. vidéo courte multi-plateforme
3. retargeting / analytics branchables plus tard
4. capture lead simple et honnête
5. Snapchat utilisé comme extension d’un moteur de contenu, pas comme système central de conversion
