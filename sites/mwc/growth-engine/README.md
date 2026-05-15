# MWC Growth Engine

Système local dans l’espace Hermes pour préparer l’acquisition, les scripts vidéo, les hooks et l’exécution growth de MWC sans dépendre immédiatement d’API externes.

## Structure
- `config/products.json` : source produit / angle / bénéfices / audiences
- `content-engine/generate_content_pack.py` : génère hooks, scripts, captions et CTA
- `video-pipeline/generate_video_assets.py` : génère manifests, overlays et sous-titres `.srt`
- `growth-ops/` : planning, registre campagnes et playbooks canal
- `agent/run_mwc_growth_agent.py` : produit un pack hebdo opérable par un humain MWC
- `output/` : sorties générées

## Workflow recommandé
1. Mettre à jour `config/products.json`
2. Générer un pack contenu :
   ```bash
   python3 content-engine/generate_content_pack.py --product sink --platform tiktok --count 8
   ```
3. Générer les assets vidéo à partir d’un pack :
   ```bash
   python3 video-pipeline/generate_video_assets.py --input output/content-packs/sink-tiktok.json
   ```
4. Générer un pack opératoire hebdo :
   ```bash
   python3 agent/run_mwc_growth_agent.py --week-label 2026-W18
   ```

## Important sur Snapchat
Ce dépôt prépare les vidéos, hooks, angles, captions et checklists. Il **ne poste pas automatiquement** sur Snapchat car cela dépend d’API officielles, des droits du compte et des règles d’automatisation.
