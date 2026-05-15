# MWC — file de sourcing média produit

Objectif: remplacer les 4 visuels catalogue encore en SVG système par de vraies photos produit ou créas fournisseur homogènes.

## Spécification visuelle cible
- format carré recommandé: 1200x1200 minimum
- fond clair ou mise en situation cuisine / tiroir / cellier cohérente
- 1 image hero nette par SKU pour la grille catalogue
- idéalement: 1 angle frontal + 1 angle lifestyle + 1 détail matière
- conserver un rendu premium, lisible sur mobile, compatible avec `object-fit: cover`

## SKU remplacés le 2026-04-25

### 1) Diviseurs de tiroirs ajustables
- ancien fichier: `assets/visuals/drawer-dividers-card.svg`
- nouveau fichier: `assets/visuals/drawer-dividers-real.jpg`
- source retenue: `https://m.media-amazon.com/images/I/71FgQid6gPL._AC_SL1500_.jpg`

### 2) Set d’organisateurs transparents de tiroir
- ancien fichier: `assets/visuals/clear-drawer-organizers-card.svg`
- nouveau fichier: `assets/visuals/clear-drawer-organizers-real.jpg`
- source retenue: `https://m.media-amazon.com/images/I/81yj+PUYVxL._AC_SL1500_.jpg`

### 3) Organisateur à couverts extensible
- ancien fichier: `assets/visuals/expandable-cutlery-tray-card.svg`
- nouveau fichier: `assets/visuals/expandable-cutlery-tray-real.jpg`
- source retenue: `https://m.media-amazon.com/images/I/61hbQeuSUpL._AC_SL1500_.jpg`

### 4) Bacs transparents empilables avec poignées
- ancien fichier: `assets/visuals/stackable-clear-bins-card.svg`
- nouveau fichier: `assets/visuals/stackable-clear-bins-real.jpg`
- source retenue: `https://m.media-amazon.com/images/I/81GZCRDFtPL._AC_SL1500_.jpg`

## Historique du besoin initial

### 1) Diviseurs de tiroirs ajustables
- fichier actuel: `assets/visuals/drawer-dividers-card.svg`
- besoin: photo montrant l’extension dans un tiroir + lisibilité avant/après
- pistes de sourcing:
  - AliExpress search: https://www.aliexpress.com/wholesale?SearchText=adjustable+drawer+dividers
  - Alibaba search: https://www.alibaba.com/trade/search?SearchText=adjustable+drawer+divider
- note de fit: privilégier les visuels à ressort / extension visibles, fond blanc ou tiroir cuisine net

### 2) Set d’organisateurs transparents de tiroir
- fichier actuel: `assets/visuals/clear-drawer-organizers-card.svg`
- besoin: set multi-formats transparent, bien rangé dans un tiroir
- pistes de sourcing:
  - Amazon search: https://www.amazon.com/s?k=clear+drawer+organizer+set
  - Temu search: https://www.temu.com/search_result.html?search_key=clear%20drawer%20organizers
- note de fit: viser un pack transparent avec plusieurs tailles visibles d’un coup

### 3) Organisateur à couverts extensible
- fichier actuel: `assets/visuals/expandable-cutlery-tray-card.svg`
- besoin: plateau à couverts extensible ouvert, lecture immédiate du bénéfice
- pistes de sourcing:
  - Joseph Joseph reference: https://us.josephjoseph.com/products/drawerstore-expanding-utensil-organiser-grey
  - Amazon search: https://www.amazon.com/s?k=Joseph+Joseph+DrawerStore+Expanding+Kitchen+Drawer+Organizer
- note de fit: montrer clairement l’extension latérale ou la largeur ajustable

### 4) Bacs transparents empilables avec poignées
- fichier actuel: `assets/visuals/stackable-clear-bins-card.svg`
- besoin: 2 ou 3 bacs transparents empilés avec poignées visibles
- pistes de sourcing:
  - iDesign reference: https://idesignlivesimply.com/collections/crisp
  - Amazon search: https://www.amazon.com/s?k=Vtopmart+clear+stackable+storage+bins+with+handles
- note de fit: privilégier une photo très nette avec poignée intégrée et transparence lisible

## Ordre recommandé
1. `drawer-dividers`
2. `clear-organizers`
3. `cutlery-tray`
4. `stackable-bins`

## Quand un asset est prêt
1. déposer l’image dans `assets/visuals/`
2. remplacer le chemin du produit dans `assets/store-config.js`
3. synchroniser vers le bridge et le pack
4. vérifier en live que la carte reste propre sur mobile
