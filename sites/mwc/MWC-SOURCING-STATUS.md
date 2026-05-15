# MWC launch status — 2026-04-25 08:03 UTC

## État public prêt à lancer
- Domaine public attendu : `https://mwc.gtixt.com`
- Staging de travail : `/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc`
- Bridge / copie de travail Hermes : `/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge`
- Pack source exportable : `/opt/hermes/data/home/mwc-storefront-pack`
- Script de sync vers le live : `/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/deploy_live_from_staging.sh`

## Ce qui est prêt maintenant
- home storefront mobile-first publiée avec produit star visible
- panier persistant via `localStorage`
- checkout avec récapitulatif, formulaire client et support email
- Stripe Checkout direct pour chaque SKU vendu à l’unité
- Stripe Checkout direct pour le bundle lancement `sink + drawer-dividers`
- pages de confiance présentes et routées : livraison, retours, FAQ, CGV, confidentialité, mentions légales, contact
- tracking de base prêt via `window.dataLayer` et GA4 déjà branché (`G-N67JG3FFZT`)

## Comportement checkout vérifié en staging
- panier vide : message d’attente, aucun faux claim
- panier 1 produit : message `Stripe Checkout direct pour ce produit`
- bundle lancement : message `Stripe Checkout direct pour le bundle sélectionné`
- panier multi-produits hors bundle : message explicite + CTA `Préparer la demande de finalisation` par email

## Blocers levés / copy corrigée
- la home ne promet plus un Stripe universel sur toutes les combinaisons
- la page checkout explique clairement la différence entre SKU unitaire, bundle et combinaison assistée
- le bouton principal du checkout s’adapte maintenant au mode réel de finalisation
- le pack exportable inclut désormais aussi `assets/runtime-config.js`, ce qui supprime le 404 console observé en vérification locale

## Reste à améliorer après lancement
- remplacer les 4 visuels catalogue encore en SVG système par de vraies photos / créas fournisseur
- créer davantage de bundles Stripe si on veut accepter plus de combinaisons sans passer par l’email
- ajouter Meta Pixel si besoin acquisition

## Améliorations UI déjà appliquées dans le staging
- cartes produit enrichies avec bénéfices courts par SKU
- mise en avant du checkout direct et du niveau d’économie sur les cartes
- lazy-loading des visuels catalogue côté grille produit
- nouvelle note opérationnelle de suivi média : `PRODUCT-MEDIA-QUEUE.md`

## Visuels catalogue
- vraie image intégrée : `assets/visuals/under-sink-organizer-real.jpg`
- encore placeholders SVG :
  - `assets/visuals/drawer-dividers-card.svg`
  - `assets/visuals/clear-drawer-organizers-card.svg`
  - `assets/visuals/expandable-cutlery-tray-card.svg`
  - `assets/visuals/stackable-clear-bins-card.svg`
- suivi sourcing et priorisation : `PRODUCT-MEDIA-QUEUE.md`

## Handoff opérationnel
1. travailler et valider dans `/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc`
2. publier depuis une session qui peut écrire sous `/opt/txt`
   - si `bash /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/deploy_live_from_staging.sh` renvoie `Permission denied` sur `/opt/txt`, ce n’est pas un bug storefront : c’est un problème de droits sur la machine live
   - dans ce cas, relancer la même commande depuis l’utilisateur/shell qui possède les droits sur `/opt/txt/sites/mwc`
3. si OK, lancer :
   ```bash
   bash /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/deploy_live_from_staging.sh
   ```
4. vérifier ensuite le domaine public `https://mwc.gtixt.com`
5. si besoin de rollback, prendre le dernier tar dans `/opt/hermes/data/home/mwc-live-staging/backups/`
