# MWC growth system plan — 2026-05-01

## Objective
Mettre en place dans l’espace Hermes un système concret pour MWC qui couvre :
1. acquisition traçable
2. capture d’intention / leads légère côté storefront
3. génération semi-automatique de contenus et scripts vidéo
4. ops marketing récurrentes (calendrier, hooks, reporting)
5. agent opérateur MWC capable de préparer les actions hebdo

## Constraints
- ne modifier que dans `/opt/hermes`
- storefront actuelle = site statique avec JS front, panier localStorage et checkout Stripe / email fallback
- aucune API publicitaire / emailing / Snapchat fournie dans le contexte
- donc : construire une base immédiatement exploitable + prête à brancher sur webhook/API plus tard

## Architecture retenue

### A. Storefront bridge (`/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge`)
Ajouts côté site :
- capture des UTM / first touch / last touch
- propagation de l’attribution vers checkout Stripe et fallback email
- bloc de capture d’intérêt sur la home
- support d’un `leadCapture.webhookUrl` optionnel
- résumé d’attribution visible au checkout
- instrumentation d’événements growth (`lead_capture_started`, `lead_capture_submitted`, `purchase_intent`, etc.)

### B. Growth engine (`/opt/hermes/data/home/dropshipping-ops/mwc-growth-engine`)
4 briques :
- `content-engine/` : source produit + générateur de hooks/scripts/captions
- `video-pipeline/` : manifestes vidéo + sous-titres + préparation FFmpeg
- `growth-ops/` : planning, registre campagnes, checklist publication, reporting hebdo
- `agent/` : guide d’exécution et scripts pour produire un pack opératoire hebdo

## What is implemented now
- storefront growth instrumentation prête
- lead capture honnête sans faux backend : webhook si configuré, sinon fallback email support
- générateurs locaux de scripts/hooks/angles multi-plateformes
- pipeline vidéo prêt à sortir manifests et `.srt`, avec commandes FFmpeg proposées
- agent MWC local qui produit un pack hebdo depuis les produits et assets disponibles

## Non-implemented external dependencies (by design)
Ces points restent volontairement non branchés car ils demandent des comptes / clés / règles produit externes :
- publication automatique Snapchat / TikTok / Meta
- achat média automatisé
- CRM/emailing tiers (Brevo, Klaviyo, Mailchimp…)
- vrai backend de leads

## Upgrade path
1. brancher `leadCapture.webhookUrl`
2. connecter GA4 / Meta via runtime config + consentement conforme
3. brancher un scheduler Hermes/cron pour générer un pack hebdo automatiquement
4. ajouter publication manuelle assistée ou API officielle selon plateforme
