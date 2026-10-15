# Prono Lab — version 2 : moteur de référence amélioré

## Changements repris de la première version

- Onglet **Bilan** pour évaluer les probabilités sur les CSV chargés.
- Backtest chronologique : une prédiction est calculée avant que le match courant soit ajouté à l'historique.
- Mesures du bilan : nombre de prédictions, taux observé, probabilité moyenne, score de Brier et résultats par championnat.
- Parsing CSV gérant les champs entre guillemets, les virgules internes, les guillemets échappés et les fins de ligne CRLF.
- Le système ne présente plus une ligne de remplacement artificielle comme un pronostic « safe » si aucune ligne ne respecte le seuil configuré.

## Nouvelle correction du moteur

- Ajout d'une estimation par marché tenant compte de l'attaque de l'équipe et des statistiques concédées par l'adversaire.
- Séparation domicile/extérieur : statistiques offensives à domicile et à l'extérieur, ainsi que les statistiques concédées dans ces mêmes contextes.
- Lissage des estimations vers la moyenne du championnat pour réduire l'instabilité des petits échantillons.
- Application du même estimateur aux matchs CSV à venir et au backtest historique pour les marchés pris en charge : cartons jaunes, tirs, fautes et corners.
- Le backtest n'utilise que les matchs antérieurs à la date de la prédiction et n'ajoute le match courant qu'après calcul.
- Si les données nécessaires sont insuffisantes, le modèle revient aux moyennes déjà disponibles pour l'affichage des matchs à venir; le bilan historique, lui, n'invente pas de prédiction et ignore ce match.

## Tests

Lancer `npm test` pour tester le parseur CSV, l'estimateur attaque/défense, le backtest chronologique, les bornes des probabilités et le score de Brier sur des données synthétiques.

Vérifications exécutées lors de la préparation de cette archive :

- `node --check server.js`
- vérification syntaxique du JavaScript intégré à `index.html`
- `npm test`

## Limites importantes

- La distribution de probabilité reste une loi de Poisson. Cette version améliore l'estimation du total attendu mais ne prouve pas que Poisson est le meilleur modèle pour les tirs, fautes, corners ou cartons.
- Les données du bilan proviennent des CSV actuellement chargés. Le projet ne télécharge pas encore automatiquement plusieurs saisons pour un backtest étendu.
- Les CSV ne permettent pas toujours de reconstruire la disponibilité exacte de chaque information avant le coup d'envoi. Les compositions, blessures et cotes historiques ne sont pas incluses dans ce modèle.
- L'arbitre n'est pas encore intégré au modèle de cartons.
- Les cotes de remplacement restent simulées et ne démontrent aucune rentabilité.
- Les historiques centralisés persistants et une page exhaustive de fraîcheur des sources restent à développer.
- Les tests sont des tests techniques sur données synthétiques, pas une validation de performance sur des matchs réels. Ne pas interpréter cette version comme une garantie de pronostics gagnants.
