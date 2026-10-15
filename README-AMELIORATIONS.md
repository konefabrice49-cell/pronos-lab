# Prono Lab — première version corrigée

## Changements

- Ajout d'un onglet **Bilan** dans la navigation.
- Ajout d'un backtest chronologique de référence pour les marchés corners, tirs, fautes et cartons jaunes, à partir des CSV déjà chargés.
- Le backtest calcule les moyennes d'équipe avec les huit observations antérieures disponibles (minimum trois), prédit avant d'ajouter le match courant à l'historique, puis calcule réussite observée, probabilité moyenne, score de Brier et résultats par championnat.
- Le parsing CSV gère désormais les champs entre guillemets, les virgules incluses dans les champs, les guillemets échappés et les fins de ligne CRLF.
- Le système ne remplace plus silencieusement une sélection ne respectant pas le seuil de 80 % par une ligne artificielle à 0,5. Si aucune ligne ne respecte le seuil, aucun pronostic « safe » n'est affiché pour ce match.
- Ajout d'un test automatisé simple pour le parsing CSV et le calcul du backtest.

## Limites connues

- Le bilan utilise seulement les CSV présents en mémoire après le chargement des matchs, et non plusieurs saisons téléchargées automatiquement. Au début d'une saison, le nombre de prédictions peut donc être trop faible pour tirer des conclusions.
- Les statistiques de référence sont une baseline simplifiée : moyenne des huit dernières observations, sans ajustement attaque/défense, terrain, adversaires, arbitre ni calibration. Le bilan ne démontre donc pas que le modèle est performant ; il donne un premier moyen de le mesurer.
- Les CSV historiques contiennent les résultats finaux et ne fournissent pas nécessairement tous les instantanés de données tels qu'ils étaient connus avant le coup d'envoi. Le backtest empêche l'utilisation des lignes futures dans les moyennes d'équipe, mais ne peut pas reconstruire l'historique de disponibilité des sources externes.
- Les cotes affichées par le moteur principal restent simulées quand aucune cote réelle n'est disponible. Elles ne doivent pas être interprétées comme des cotes de bookmaker.
- L'historique centralisé persistant et la page complète de fraîcheur des sources ne sont pas inclus dans cette première modification.

## Tests exécutés

Lancer `npm test` pour vérifier le parsing CSV, la génération chronologique de prédictions, les bornes des probabilités et le score de Brier sur un jeu synthétique.

Vérifications effectuées sur cette version : `node --check server.js`, vérification syntaxique du JavaScript intégré à `index.html` et `npm test`.
