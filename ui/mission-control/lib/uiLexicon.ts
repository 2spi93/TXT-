export const UI_TERMS = {
  readiness: "Readiness",
  driftLog: "Drift Log",
  diagnostics: "Diagnostics",
  executionGap: "Execution Gap",
  marketRegime: "Market Regime",
  tradingTerminal: "Trading Terminal",
  incidents: "Incidents",
  decisionReality: "Decision Reality",
} as const;

export type UiHelpHint = {
  text: string;
  examples: string[];
};

export const UI_HELP_HINTS = {
  runtimeDecisionOverview: {
    text: "Lecture compacte des refus d'execution: bucket dominant, codes majeurs, hygiene de journal et contexte de marche.",
    examples: [
      "Si market domine, traite d'abord la rarete d'edge et le routing score.",
      "Si runtime domine, va verifier readiness, recovery, fallback et bridge avant toute calibration.",
    ],
  },
  runtimeOperatorMonitoring: {
    text: "Lecture operateur live: drift, opportunite, stale XCH, bus lag et clusters NO_TRADE sans reconstruire une seconde verite.",
    examples: [
      "Si XCH stale monte alors que bus/UI restent coherents, traite d'abord la fraicheur de la source de marche.",
      "Si missed opportunity est eleve cote runtime/policy, la heatmap aide a voir ou les blocages se concentrent vraiment.",
    ],
  },
  dashboardSecurity: {
    text: "RBAC, rotation mot de passe, signatures et garde-fous d'execution.",
    examples: [
      "Avant un passage live, verifie que ton role est correct et que Paper only n'est pas incoherent.",
      "Si un ordre sensible doit sortir, assure-toi que la validation HMAC et les approvals sont disponibles.",
    ],
  },
  dashboardImprovementDesk: {
    text: "Lecture operateur des propositions, simulations et validations avant toute couche de deploiement.",
    examples: [
      "Un ACCEPT avec delta pnl positif mais drawdown en hausse doit encore etre juge par un humain.",
      "Si la simulation reste en heuristic_fallback, ne traite pas le resultat comme une preuve forte.",
    ],
  },
  dashboardDeploymentDesk: {
    text: "Canary versionne, monitoring post-change et rollback prepare. Rien n'entre ici sans validation ACCEPT.",
    examples: [
      "Un canary CONFIRMED passe en full rollout logique sans perdre la trace de sa config versionnee.",
      "Si le monitoring voit slippage ou drawdown se degrader, le rollback devient immediatement recommandable.",
    ],
  },
  dashboardNextStepArchitecture: {
    text: "Ordre de delivery valide niveau production: drift avant densite d'opportunite, puis dashboard, puis calibration lente.",
    examples: [
      "Ne calibre rien si la verite journal/runtime est encore confuse.",
      "Un dashboard sans drift engine observe juste des symptomes: il ne detecte pas les changements de comportement du systeme.",
    ],
  },
  dashboardVenueHealth: {
    text: "Badge unifie backend pour savoir si l'execution est bloquee, reduite ou nominale.",
    examples: [
      "Si le badge passe en REDUCE SIZE, la taille live backend est deja rabotee.",
      "Si le badge passe en LIVE BLOCKED, ne cherche pas a forcer un smoke test: le control-plane coupe deja l'execution.",
    ],
  },
  dashboardDataMeshHealth: {
    text: "Supervision des venues de marche prioritaires pour la migration venue-aware.",
    examples: [
      "OKX, Binance et Bybit servent ici de thermometre data/market-health.",
      "Une venue peut etre bonne en data mais non prete en execution si aucun compte trade n'est lie.",
    ],
  },
  dashboardPublicProbe: {
    text: "Reference probe du chart public. Ce bloc ne parle pas forcement de l'onglet terminal local en face de toi.",
    examples: [
      "Si ce probe est green mais le terminal local est rouge, le probleme est dans l'instance locale ou son feed choisi.",
      "Si failure reason=freshness, le chart public peut encore rendre des bougies mais avec retard.",
    ],
  },
  dashboardLocalTerminalCapture: {
    text: "Snapshot persiste de l'onglet terminal actif. C'est la source de verite pour verifier les pills exactes d'une instance locale.",
    examples: [
      "Si tu vois BUS OFFLINE dans l'onglet, ce bloc doit montrer la meme chose ici si cette instance publie encore ses captures.",
      "Le client id permet de distinguer plusieurs onglets ou postes de travail si necessaire.",
    ],
  },
  dashboardBalances: {
    text: "Liquidite par devise depuis le broker adapter.",
    examples: [
      "Si USDT libre baisse trop, reduis la taille des nouveaux ordres crypto.",
      "Si USD libre est a zero, n'envoie pas de ticket forex sans reallouer du cash.",
    ],
  },
  dashboardPositions: {
    text: "Exposition nette en temps reel par instrument.",
    examples: [
      "Si BTCUSD est trop gros par rapport au reste, coupe ou hedge avant un news event.",
      "Si une ligne apparait ici alors qu'aucun bot ne devrait tourner, va verifier Connecteurs et Incidents.",
    ],
  },
  dashboardMarketData: {
    text: "Derniers ticks consolides pour supervision rapide.",
    examples: [
      "Utilise ce bloc pour voir en 2 secondes si le prix bouge encore normalement.",
      "Si le dernier prix semble fige, suspecte un connecteur de marche ou un broker en retard.",
    ],
  },
  dashboardAuditTrail: {
    text: "Journal d'evenements pour non-repudiation et gouvernance.",
    examples: [
      "Si un operateur dit qu'il n'a rien fait, verifie ici la trace exacte.",
      "Si une approbation live est contestee, l'audit trail est la premiere preuve a lire.",
    ],
  },
  dashboardPendingApprovals: {
    text: "Intentions acceptees par le risk gateway en attente de validation humaine.",
    examples: [
      "Exemple: une strategie propose un ordre, le risk gateway l'accepte, l'humain clique Approve ici.",
      "Si tu ne comprends pas le contexte d'un intent, n'approuve pas: ouvre IA ou Incidents pour investiguer.",
    ],
  },
  dashboardStrategyRegistry: {
    text: "Catalogue des strategies avec progression de niveau et promotions.",
    examples: [
      "Create Strategy: enregistre une nouvelle strategie avant de la tester ailleurs.",
      "Promote: passe L2 vers L3 seulement si sharpe, drawdown et rationale sont solides.",
    ],
  },
  aiRoutesAvailable: {
    text: "Ce bloc montre quelles routes IA sont disponibles, combien elles coutent et si une protection s'est declenchee.",
    examples: [
      "Si une route importante manque, il faut le voir avant de lancer une tache.",
      "Si une route tombe souvent en secours, le probleme vient de l'infrastructure plus que du prompt.",
    ],
  },
  aiMachineCapacity: {
    text: "Ce bloc dit si la machine peut vraiment porter des taches locales ou s'il vaut mieux s'appuyer sur le distant.",
    examples: [
      "Une machine sans GPU peut rester utile pour du leger mais pas pour du lourd.",
      "Si le local ne repond pas, il faut basculer vers les routes distantes prevues.",
    ],
  },
  aiVisibleFundsOrigin: {
    text: "Ce bloc rappelle d'ou viennent les fonds visibles derriere le desk: test, reel, exchange ou wallet.",
    examples: [
      "Un montant visible en mode test n'est pas du capital reel.",
      "Un exchange ou un wallet peut etre branche sans etre encore pret pour une vraie allocation.",
    ],
  },
  aiLaunchTask: {
    text: "Zone de lancement controlee pour les taches IA importantes, avec limite de cout et choix de route.",
    examples: [
      "Pour une tache sensible, relis la route finale avant d'utiliser la reponse.",
      "Le mode local n'a de sens que si le service local repond bien.",
    ],
  },
  aiLocalModels: {
    text: "Ce bloc sert a voir si les modeles locaux repondent et a les preparer au debut de la session.",
    examples: [
      "Lance le prechauffage si tu comptes utiliser le local aujourd'hui.",
      "Si les modeles restent hors ligne, traite-le comme un souci d'infrastructure.",
    ],
  },
  aiMarketContextRead: {
    text: "Lit trois scores normalises pour classer le contexte: tendance, volatilite realisee et sentiment.",
    examples: [
      "trend_score vient d'un signal de tendance entre 0 et 1: 0.4 = modere, 0.8 = fort.",
      "realized_volatility est la volatilite observee: 0.055 veut dire environ 5.5% sur la fenetre du signal.",
      "sentiment_score va de -1 a 1 quand la source sentiment est disponible.",
    ],
  },
  aiStrategyStressTest: {
    text: "Teste une strategie face a un scenario macro, geopolitique ou operationnel avant promotion live.",
    examples: [
      "Fed emergency hike, exchange outage ou oil shock servent a voir si le cadre tient encore.",
      "Resilience haute = plus robuste; drawdown attendu haut = promotion live a retarder ou reduire.",
    ],
  },
  aiMemoryCalibration: {
    text: "Ce bloc dit simplement si l'aide memoire semble utile ou si le sujet reste encore ouvert.",
    examples: [
      "Sans assez d'exemples, il ne faut pas tirer de conclusion.",
      "Si l'ecart reste faible ou flou, garde une lecture prudente.",
    ],
  },
  aiTasksJournal: {
    text: "Historique des taches IA pour revoir ce qui a tourne, ce qui a echoue et ce qui merite un tri.",
    examples: [
      "Si l'historique montre beaucoup de passages degrades, il faut regarder la capacite ou les routes.",
      "Nettoyer l'historique sert a garder un journal lisible, pas a cacher un probleme.",
    ],
  },
  fundCapitalIntegration: {
    text: "Montre combien d'argent reel est place dans chaque poche et si on s'eloigne du plan prevu.",
    examples: [
      "Une poche peut sembler bonne sur le papier mais manquer de capital reel.",
      "Separe toujours l'argent disponible et la valeur totale du compte pour eviter les malentendus.",
    ],
  },
  fundMandateDiscipline: {
    text: "C'est ici que tu poses les regles du fonds: but, limites et facon de prendre le risque.",
    examples: [
      "Si l'objectif ou les limites ne sont pas clairs, le reste de la page devient difficile a lire.",
      "Avant de monter le risque, verifie que la decision reste dans le cadre prevu.",
    ],
  },
  fundRegimePolicyByHorizon: {
    text: "Ce bloc aide a decider quel style de prise de position convient au contexte du moment.",
    examples: [
      "Quand le marche devient instable, reduis les prises rapides et garde des tailles plus modestes.",
      "Quand le contexte est plus lisible, tu peux laisser respirer des positions plus longues.",
    ],
  },
  fundSleevesArchitecture: {
    text: "Les poches servent a separer les approches, renforcer celles qui tiennent et reduire celles qui pesent trop.",
    examples: [
      "Si une poche gagne mais prend trop de risque, baisse sa taille plutot que de l'ignorer.",
      "Si une autre reste stable et utile, tu peux lui donner un peu plus de place.",
    ],
  },
  fundIcNotes: {
    text: "Cette zone garde la memoire des decisions: ce qu'on pensait, ce qu'on a vu et ce qu'on change.",
    examples: [
      "Apres la revue de semaine, note ce qui a aide, ce qui a echoue et l'action retenue.",
      "Si une limite change, ecris-la ici avant de toucher aux tailles ou au capital.",
    ],
  },
  fundAllocatorReporting: {
    text: "Ce bloc resume le fonds de facon lisible: resultat, baisse, exposition et origine principale de la performance.",
    examples: [
      "Avant un echange avec un investisseur, verifie d'abord le resultat recent, la pire baisse et l'exposition actuelle.",
      "Si une seule poche explique presque tout, il faut pouvoir le dire simplement.",
    ],
  },
  fundLiveRiskOverlay: {
    text: "Ici, tu dois voir tout de suite si le fonds reste sous controle ou s'il faut calmer le jeu.",
    examples: [
      "Si une poche prend trop de place et que la baisse s'aggrave, reduis-la vite.",
      "Si tout se met a bouger dans le meme sens, considere que la diversification protege moins qu'avant.",
    ],
  },
  liveCanonicalAllocableSources: {
    text: "Ces sources sont deja pretes dans le registre principal. Tu peux donc les verifier, les rattacher a un portefeuille et les utiliser.",
    examples: [
      "Un compte reel deja valide peut etre alloue directement.",
      "Un exchange deja prepare peut afficher ses montants avant allocation.",
    ],
  },
  livePlatformNonCanonicalSources: {
    text: "Ces sources sont deja branchees, mais pas encore pretes pour une allocation officielle.",
    examples: [
      "Un exchange relie par cle API peut apparaitre ici sans etre encore utilisable.",
      "Un wallet en lecture seule peut etre visible mais rester hors allocation.",
    ],
  },
  liveDeskStructuring: {
    text: "Ce bloc sert a decrire comment tu veux utiliser la source: type de compte, role du capital, lieu d'execution et rythme de remise a niveau.",
    examples: [
      "Un compte principal peut servir au coeur de l'activite avec plusieurs plateformes.",
      "Une reserve peut rester separee avec un usage plus prudent.",
    ],
  },
  liveVenuePocketsPrime: {
    text: "Montre ou l'argent est range sur la source: comptant, derives, options, garde ou on-chain.",
    examples: [
      "Une plateforme peut avoir plusieurs poches, mais elles n'apparaissent que si la synchronisation les remonte bien.",
      "Un wallet de reserve sera plutot vu comme garde ou reserve que comme compte d'execution rapide.",
    ],
  },
  liveRegisterExchangeBeforeAllocation: {
    text: "Renseigne ici les acces crees sur l'exchange. TXT verifie maintenant la cle tout de suite pour eviter d'enregistrer un mauvais acces.",
    examples: [
      "Pour OKX, remplis la cle API, le secret API, la passphrase creee avec la cle et l'identifiant du compte ou du sous-compte.",
      "Choisis Lecture seule pour surveiller, ou Trading autorise si la source doit vraiment executer.",
    ],
  },
  liveConnectWalletCustody: {
    text: "Ce bloc sert a brancher un wallet ou une solution de garde avant verification puis allocation.",
    examples: [
      "Une adresse publique suffit pour suivre un wallet.",
      "La signature doit rester hors TXT, via un systeme externe prevu pour ca.",
    ],
  },
  liveUpdateVenueApiAccess: {
    text: "Cette section sert a remplacer la cle API, le secret ou la passphrase d'un exchange deja lie sans recreer toute la source.",
    examples: [
      "Selectionne d'abord la source exchange active, puis remplace ses acces API.",
      "Apres mise a jour, TXT relance automatiquement une sync si le compte est deja canonique.",
    ],
  },
  liveCreatePortfolio: {
    text: "Le portefeuille sert a ranger la source dans le bon cadre, avec un poids et une limite en dollars.",
    examples: [
      "Cree d'abord le portefeuille du client, puis rattache la source.",
      "Une reserve peut vivre dans un portefeuille separe du capital actif.",
    ],
  },
  liveAllocateConnectedSource: {
    text: "C'est ici que la source passe d'un simple branchement a un capital vraiment encadre.",
    examples: [
      "Verifie d'abord le montant reel, puis fixe une limite inferieure ou egale a ce qui a ete confirme.",
      "Pour une reserve, commence avec une limite prudente.",
    ],
  },
  liveBingxSimple: {
    text: "Ce bloc explique le montant que TXT peut utiliser sur BingX sans transformer un micro-test en vrai pari trop gros.",
    examples: [
      "Capital visible: environ 136.68 USDT si la verification remonte bien ce total.",
      "Cap micro conseille: 4.5 USD. Au-dessus de 5 USD, TXT doit demander une validation humaine.",
    ],
  },
  livePlatformFundsVerification: {
    text: "Ce bloc lit le compte pour afficher ce qui est vraiment visible: montants, positions et total confirme.",
    examples: [
      "Avant d'allouer, commence toujours par cette verification.",
      "Si aucun total ne remonte, la source est branchee mais pas encore bien lue par le systeme.",
    ],
  },
  liveAgentStrategyReadiness: {
    text: "Une strategie ne doit passer sur du vrai capital que si la source est claire, verifiee et bien limitee.",
    examples: [
      "L'agent peut proposer, mais c'est a l'operateur de valider le passage.",
      "Si le compte montre 10k USD, evite une limite plus haute que le montant confirme.",
    ],
  },
  liveCapitalVerified: {
    text: "Ce badge dit si la lecture du capital est fiable ou si un humain doit relire la situation.",
    examples: [
      "Vert si les differentes poches retombent bien sur le total attendu.",
      "Orange si quelque chose semble incomplet.",
      "Rouge si les montants se contredisent vraiment.",
    ],
  },
  liveAssetBreakdown: {
    text: "Montre le detail de chaque poche avec les actifs, leur valeur et leur poids dans le total.",
    examples: [
      "Tu peux voir rapidement quels actifs dominent la source.",
      "La couleur aide a reperer ce qui monte ou baisse sur la periode affichee.",
    ],
  },
  liveRiskOverlayCapital: {
    text: "Ce bloc resume le niveau de risque pris par la source: taille globale, concentration et marge de securite restante.",
    examples: [
      "Un compte simple reste souvent peu levierise.",
      "Si une poche grossit trop, elle fait monter le risque total.",
    ],
  },
  liveCapitalFlowEngine: {
    text: "Ici, tu vois les mouvements d'argent observes sur la source: entrees, sorties, transferts et resultat encaisse.",
    examples: [
      "Un deplacement entre deux poches apparait comme un vrai mouvement suivi dans le temps.",
      "Les frais et le resultat realise sont regroupes ici pour raconter l'histoire du compte.",
    ],
  },
  livePortfolioAttribution: {
    text: "Ce bloc aide a comprendre d'ou vient le resultat: quelle source, quelle strategie ou quel actif a le plus compte.",
    examples: [
      "Tu peux voir si le resultat vient surtout d'une plateforme precise.",
      "Tu peux aussi reperer quelle strategie ou quel actif pese le plus dans le bilan.",
    ],
  },
  liveRunbook: {
    text: "C'est la checklist simple avant d'autoriser un agent a toucher du vrai capital.",
    examples: [
      "Branchement, verification, preparation, allocation, puis seulement apres passage en live.",
      "S'il manque une etape, considere la source comme non prete.",
    ],
  },
  liveAllocatorReadinessMatrix: {
    text: "Cette matrice resume ce qu'il manque encore avant d'utiliser la source dans de bonnes conditions.",
    examples: [
      "Un score complet veut dire que la source est claire et prete.",
      "Si la limite depasse l'argent confirme, la preparation n'est pas terminee.",
    ],
  },
  liveStrategiesReminder: {
    text: "Rappel du niveau des strategies pour eviter d'envoyer trop vite du vrai capital sur un setup encore fragile.",
    examples: [
      "Une strategie encore en observation merite une relecture avant tout passage reel.",
      "Regarde toujours son niveau actuel avant de la promouvoir.",
    ],
  },
  connectorsMt5Bridge: {
    text: "Sante bridge MT5 et compteur des validations live en attente.",
    examples: [
      "Si Pending live approvals monte, un second validateur doit venir ici ou sur le terminal.",
      "Si status n'est pas healthy, n'envoie pas de nouvel ordre live.",
    ],
  },
  connectorsLiveConnectors: {
    text: "Disponibilite instantanee des integrations critiques.",
    examples: [
      "Chaque ligne doit etre healthy=true avant une vraie session de trading.",
      "Si un connecteur devient false, considere l'environnement comme degrade jusqu'a verification.",
    ],
  },
  connectorsMt5Accounts: {
    text: "Inventaire des comptes raccordes et leur mode paper/live.",
    examples: [
      "Cherche ici ton compte demo pour verifier qu'il est bien en paper avant un test.",
      "Ne bascule pas en live sans voir clairement le mode et le status attendus.",
    ],
  },
  connectorsFtmoGovernance: {
    text: "Lecture directe de la phase active FTMO, des seuils de hardening et des caps de sizing par bucket.",
    examples: [
      "Phase micro_risk: seuls les tickets les plus petits doivent passer et tout drift regime doit compresser le sizing.",
      "Si Oracle Stability descend sous le seuil blocant, le desk doit rester NO TRADE meme si la confiance brute reste elevee.",
    ],
  },
  connectorsMt5SizingPreview: {
    text: "Simulation operateur du bucket choisi et du decay de regime reellement injectes dans la policy live.",
    examples: [
      "Monte la confiance a 0.92 pour verifier le passage standard -> premium si le cap FTMO le permet.",
      "Si le decay regime tombe a 0.72, la taille doit se compresser automatiquement avant execution.",
    ],
  },
  connectorsExecutionCapabilitiesByAccount: {
    text: "Vue operateur dediee pour voir quel compte peut vraiment executer un cancel/replace natif et quel compte reste en reslice.",
    examples: [
      "Si un compte affiche CANCEL REPLACE=true et MODIFY=false, le scheduler doit rester sur cancel_replace et non sur amend natif.",
      "Si un compte est trade=false, traite ses capacites comme purement informatives tant qu'il n'est pas habilite execution.",
    ],
  },
  connectorsReplacePathByAccount: {
    text: "Lecture directe du chemin de remplacement expose par le control-plane pour chaque compte lie.",
    examples: [
      "Un compte BingX doit aujourd'hui montrer replace strategy = CANCEL REPLACE et modify = false.",
      "Si un futur broker confirme amend natif, cette matrice devra montrer MODIFY avant tout basculement du scheduler.",
    ],
  },
  connectorsRightsByConnector: {
    text: "Granularite des droits, scopes et contraintes de signature par compte lie.",
    examples: [
      "Verifie qu'un compte exchange n'a pas withdraw=true si son role est uniquement execution.",
      "Pour les wallets, la policy doit montrer hardware, MPC ou signer externe, jamais une cle privee en clair.",
    ],
  },
  connectorsFallbackPlanByConnector: {
    text: "Diagnostic et plan d'auto-downgrade par venue.",
    examples: [
      "Si WS drop ou feed degraded, la chaine doit montrer WS -> REST -> stale cache.",
      "Si l'etat devient critical, le live doit passer read-only et proposer un reroute venue.",
    ],
  },
  connectorsCapitalIntegrationByVenue: {
    text: "Vision capital et risque par venue/connecteur raccorde au Fund Manager.",
    examples: [
      "Compare valeur plateforme et cash brut pour savoir si la venue est sur-inventorisee ou vraiment liquide.",
      "Regarde le drift vs Fund Manager avant de laisser l'OMS router plus de risque sur cette venue.",
    ],
  },
  connectorsClientPortfolioView: {
    text: "Agregat interne client par client pour verifier la repartition des comptes et l'exposition canonique.",
    examples: [
      "Un client peut porter plusieurs comptes mais un seul portfolio ops principal.",
      "Cette vue aide a reperer un compte MT5 rattache au mauvais client ou au mauvais portfolio.",
    ],
  },
  connectorsRealtimeAlerts: {
    text: "Alertes websocket: kill-switch, validations live, incidents.",
    examples: [
      "Si une alerte kill-switch apparait, stoppe les actions execution et va d'abord sur Incidents.",
      "Si une alerte live approval arrive, ouvre le bloc de double validation juste en dessous.",
    ],
  },
  connectorsLiveApprovalHistory: {
    text: "Traite la preuve de double approbation des ordres live.",
    examples: [
      "Apres un ordre live, verifie ici qui a fait la seconde approbation.",
      "Si une validation manque, ne considere pas l'execution comme completement gouvernee.",
    ],
  },
  connectorsFtmoWorkflow: {
    text: "Vue operateur simplifiee: ou raccorder FTMO, ou creer une demande live, et ou faire la seconde approbation.",
    examples: [
      "1. Connections: brancher le compte FTMO et la vraie broker session.",
      "2. Terminal ou Connectors: creer la demande d'ordre live.",
      "3. Connectors ou Live Capital: un autre operateur valide en second.",
    ],
  },
  connectorsMt5ConnectionForm: {
    text: "Formulaire de raccordement compte MT5 au bridge.",
    examples: [
      "Exemple: entre mt5-demo-01, serveur demo, login demo, puis clique Connecter le compte.",
      "Utilise paper pour tester le pipeline sans risque reel.",
    ],
  },
  connectorsMt5OrderRequestRisk: {
    text: "Prepare une demande d'ordre MT5 et la fait passer par les controles risque, spread, slippage et double validation live.",
    examples: [
      "EURUSD, buy, 0.10 lot, notional prudent et raison courte: le systeme repond approval si le live demande une seconde validation.",
      "Si le spread est trop large ou le marche est ferme, l'ordre doit rester bloque plutot que simuler un vrai broker.",
    ],
  },
  connectorsMt5LiveApprovals: {
    text: "Second validateur requis pour execution compte live.",
    examples: [
      "Quand une demande arrive ici, un autre operateur doit cliquer Valider en second.",
      "Si rien n'apparait ici, l'ordre est soit en paper, soit pas encore eligibile au live.",
    ],
  },
  connectorsPropFirmNoMt5: {
    text: "Cadrage pour les clients prop qui utilisent une plateforme proprietaire au lieu de MT5.",
    examples: [
      "Si la firme expose une API, TXT doit passer par un adaptateur natif plateforme plutot que par MT5.",
      "Sans API, la bonne voie est souvent un connecteur OMS/FIX ou un workflow semi-assiste, pas un faux bridge fragile.",
    ],
  },
  connectorsOnboardingHub: {
    text: "Point d'entree unique pour les demandes de connexion client/trader hors MT5 natif.",
    examples: [
      "Choisis exchange puis OKX si le client veut brancher un compte API spot/perp.",
      "Choisis wallet puis MetaMask si le trader veut un flux on-chain signe depuis son navigateur.",
    ],
  },
  connectorsLastResult: {
    text: "Sortie detaillee de la derniere action API executee.",
    examples: [
      "Lis ce JSON juste apres une action pour comprendre la reponse brute du systeme.",
      "Si quelque chose echoue, copie surtout detail, status ou approval_id pour le diagnostic.",
    ],
  },
  connectionsDirectMt5: {
    text: "Point d'entree client pour rattacher un compte MetaTrader 5 paper ou live a TXT, y compris FTMO via MT5.",
    examples: [
      "Pour FTMO, branche le compte en mode live, puis utilise ensuite la route live plus bas pour l'activer cote agent.",
      "Commencez par paper pour tester le pipeline complet sans risque reel.",
    ],
  },
  connectionsMt5BrokerSessionSource: {
    text: "Persiste ici la source externe du broker_state MT5 et l'URL d'execution live reelle. Sans execution_url, le bridge MT5 live bloque maintenant l'ordre au lieu de simuler un accepted.",
    examples: [
      "Snapshot URL + payload_path = TXT lit le JSON externe, puis l'injecte dans le bridge MT5 canonique.",
      "Execution URL = TXT envoie le vrai ticket MT5 live a la session broker externe au lieu de simuler un ordre.",
      "Effacer la source remet broker_session a vide pour couper l'ingestion automatique et l'execution live.",
    ],
  },
  connectionsRegisterExchange: {
    text: "Enregistre un compte exchange API sans confondre connexion, allocation et autorisation live.",
    examples: [
      "Un exchange peut etre visible ici avant d'etre autorise a recevoir du capital ou des ordres live.",
      "Apres enregistrement, verifie les capabilities, balances et routes avant toute execution gouvernee.",
    ],
  },
  connectionsLiveIntegrationRoute: {
    text: "Expose la creation de route pour un signal autonome vers un compte lie, exchange ou broker MT5/FTMO.",
    examples: [
      "Source market-regime + route default + live enabled = le moteur peut demander du vrai live gouverne vers BingX ou un compte MT5 FTMO.",
      "Si tu veux rester sans risque, desactive live_enabled ou garde un venue paper.",
    ],
  },
  connectionsWalletOnchain: {
    text: "Liez ici une adresse publique ou une reference custody. TXT ne doit jamais recevoir la cle privee du wallet.",
    examples: [
      "Solana: renseignez l'adresse publique et un label clair.",
      "Pour du trade on-chain agentique, utilisez Fireblocks, Safe ou un wallet adapter compatible.",
    ],
  },
  connectionsNonStandardOnboarding: {
    text: "Demande client pour les connexions hors parcours directs deja supportes.",
    examples: [
      "Choisissez prop firm si votre venue utilise une plateforme proprietaire.",
      "Utilisez ce bloc quand l'integration demande FIX, OAuth specifique ou un adaptateur dedie.",
    ],
  },
  kairosShadowStartObservation: {
    text: "Demarre une analyse automatique qui tourne en continu. Ici, le moteur Market Regime observe et journalise ce qu'il ferait; ce bouton ne ferme pas et n'ouvre pas une position depuis cette page.",
    examples: [
      "A utiliser quand tu veux laisser le moteur surveiller le marche tout seul.",
      "Si tu veux juste tester maintenant, utilise plutot Lancer une fois.",
    ],
  },
  kairosShadowStopLoop: {
    text: "Met la boucle Market Regime en pause. Cela stoppe l'analyse automatique de cette couche, mais ne ferme pas une position deja ouverte ailleurs.",
    examples: [
      "A utiliser si tu ne veux plus que le moteur continue a analyser sans toi.",
      "Le bouton d'urgence execution reste separe du bouton pause du moteur.",
    ],
  },
  kairosShadowRunOnce: {
    text: "Fait une seule analyse maintenant, puis s'arrete. C'est le bouton le plus simple pour verifier ce que le moteur pense sans le laisser tourner en continu.",
    examples: [
      "Clique ici pour un test rapide.",
      "Lis ensuite les raisons dans le journal des cycles.",
    ],
  },
  terminalExecutionBlotter: {
    text: "Journal des executions recentes.",
    examples: [
      "Si slippage monte brutalement, suspecte broker ou routeur degrade.",
    ],
  },
  terminalPerformanceDesk: {
    text: "Le Performance Desk relie les chiffres de performance au type de capital sous-jacent: broker live, broker paper, exchange ou wallet.",
    examples: [
      "Avant de lire une bonne perf comme du vrai live, regarde la ligne source-capital juste en dessous.",
      "Si une source exchange n'est pas canonique, elle ne doit pas etre lue comme du capital pleinement gouverne.",
    ],
  },
  terminalInvestorReport: {
    text: "Resume du dernier reporting investisseur genere pour donner une lecture client ou comite du portefeuille.",
    examples: [
      "Si aucun rapport n'apparait, le desk reste lisible pour l'ops mais pas encore pour un reporting client propre.",
      "Le scope du rapport aide a comprendre quel portefeuille ou quelle strategie est couverte.",
    ],
  },
  terminalExecutionLane: {
    text: "Route preferee, surveillance slippage/latence, replay et ticket d'ordre gouverne.",
    examples: [
      "Route preferee = venue avec le plus petit spread.",
      "Replay = dernier fill series avec timeline et histogramme slippage.",
    ],
  },
} as const satisfies Record<string, UiHelpHint>;

export function formatReasonLabel(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "n/a";
  }
  return trimmed.replace(/_/g, " ");
}
