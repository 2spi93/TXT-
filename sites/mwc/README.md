# MWC Storefront Pack

Version storefront prête au lancement pour `mwc.gtixt.com`.

## Source de vérité actuelle
- staging à éditer : `/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc`
- bridge Hermes : `/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge`
- pack exportable : `/opt/hermes/data/home/mwc-storefront-pack`

## Ce qui est branché
- home de vente mobile-first
- panier persistant via `localStorage`
- checkout avec formulaire client + récapitulatif
- Stripe Checkout direct pour chaque produit vendu seul
- Stripe Checkout direct pour le bundle lancement `sink + drawer-dividers`
- finalisation assistée par email pour les paniers multi-produits non couverts par un bundle Stripe
- pages de confiance : livraison, retours, FAQ, CGV, confidentialité, mentions légales, contact
- GA4 déjà configuré via `G-N67JG3FFZT`

## Fichiers clés
- `index.html` — home storefront
- `pages/checkout.html` — checkout MWC
- `assets/store-config.js` — produits, prix, liens checkout
- `assets/app.js` — logique panier / checkout / analytics
- `assets/styles.css` — styles
- `MWC-SOURCING-STATUS.md` — statut lancement et handoff
- `STRIPE_SETUP.md` — logique checkout et règles de configuration

## Règle checkout actuelle
1. **1 SKU dans le panier** → redirection Stripe Checkout directe via le lien du produit
2. **bundle lancement exact** → redirection Stripe Checkout directe via le lien bundle
3. **autre combinaison multi-SKU** → fallback assisté par email, annoncé explicitement dans le checkout

## Déploiement live
```bash
bash /opt/hermes/data/home/dropshipping-ops/mwc-site-bridge/deploy_live_from_staging.sh
```

Important : la commande doit être lancée depuis une session/utilisateur qui peut écrire dans `/opt/txt/sites/mwc`. Si le script échoue avec `Permission denied` sur `/opt/txt`, le pack est prêt mais la publication doit être relancée depuis la machine ou le compte qui possède ces droits.

## Vérification recommandée après sync
- ouvrir `https://mwc.gtixt.com`
- tester un panier à 1 produit
- tester le bundle lancement
- tester un panier multi-produits hors bundle pour confirmer le message assisté
- vérifier les pages de confiance

## Améliorations post-lancement
- remplacer les 4 visuels SVG restants par de vrais assets fournisseur
- ajouter d’autres bundles Stripe si on veut réduire les cas assistés
- ajouter Meta Pixel si besoin acquisition
