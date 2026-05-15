# MWC Execution & Deploy

## Ce qui a été ajouté
### Storefront
- attribution marketing first-touch / last-touch
- pushes `dataLayer` pour home, add-to-cart, begin-checkout, purchase-intent, lead capture
- compatibilité optionnelle GA4 / Meta Pixel
- bloc lead capture sur la homepage
- résumé attribution visible au checkout
- consentement marketing dans le checkout

### Growth engine
- `growth-engine/config/products.json`
- `growth-engine/content-engine/generate_content_pack.py`
- `growth-engine/video-pipeline/generate_video_assets.py`
- `growth-engine/growth-ops/*`
- `growth-engine/agent/run_mwc_growth_agent.py`
- sorties d’exemple déjà générées dans `growth-engine/output/`

## Exécution locale dans le bridge Hermes
Depuis :
`/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/growth-engine`

### 1. Générer un pack contenu
```bash
python3 content-engine/generate_content_pack.py --product sink --platform tiktok --count 6
```

### 2. Générer les assets vidéo
```bash
python3 video-pipeline/generate_video_assets.py --input output/content-packs/sink-tiktok.json
```

### 3. Générer un pack agent hebdo
```bash
python3 agent/run_mwc_growth_agent.py --week-label 2026-W18 --count-per-pack 4
```

## Config branchable ensuite
### Analytics
Éditer `assets/runtime-config.js` pour injecter :
- `gaMeasurementId`
- `metaPixelId`
- `debug`

### Lead capture backend
Toujours dans `assets/runtime-config.js`, ajouter :
```js
leadCapture: {
  webhookUrl: 'https://example.com/webhook/mwc-leads'
}
```

Sans webhook, le site bascule proprement vers un envoi assisté par email.

## Validation effectuée
- `node --check assets/app.js`
- `python3 -m py_compile` sur les scripts growth engine
- génération réelle d’un pack Snapchat
- génération réelle d’un manifest vidéo
- génération réelle d’un pack hebdo agent

## Déploiement via bridge
Depuis le bridge :
```bash
bash /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/deploy_live_from_staging.sh
```

Le script :
- synchronise le bridge vers le staging Hermes si disponible
- tente la synchro live si la session a le droit d’écriture
- écrit un état dans `deploy-request.latest.txt`

## Vérifications post-déploiement
1. ouvrir la home MWC
2. vérifier le bloc lead capture
3. tester un panier 1 SKU
4. tester le bundle lancement
5. vérifier le résumé attribution au checkout
6. vérifier qu’un lead sans webhook ouvre bien le mail support
7. vérifier la présence du dossier `growth-engine/` côté bridge publié

## Limite volontaire
Snapchat n’est pas automatisé en publication dans ce setup. Le système prépare la matière (hooks, scripts, overlays, manifests), mais la diffusion Snapchat doit rester validée humainement ou branchée plus tard via une intégration officielle conforme.
