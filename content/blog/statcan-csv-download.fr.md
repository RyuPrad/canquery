## Partir du numéro de tableau

Statistique Canada publie de nombreuses ressources sous un nom générique comme « Ensembles de données ». Le tableau parent permet de savoir ce que contient le fichier. Cet exemple utilise le tableau **35-10-0007**, sur les admissions des jeunes aux services correctionnels selon l’identité autochtone et le sexe. Ouvrez sa [fiche dans CanQuery](/datasets/4f8575f0-918e-41bb-bcde-044d04caaf31), puis comparez le titre au [tableau officiel de Statistique Canada](https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=3510000701).

La page officielle utilise l’identifiant `3510000701`, tandis que le téléchargement CSV du tableau complet porte `35100007` dans son nom. Conservez le numéro du tableau avec votre analyse afin qu’une autre personne puisse retrouver le même sujet. La date de mise à jour des métadonnées du catalogue ne correspond pas à la période de référence de chaque observation.

## Choisir une archive et vérifier sa langue

[Ouvrez les détails de la ressource CSV anglaise](/resources/94e53244-91df-495e-b5d8-93ba224a5246), vérifiez la langue enregistrée, puis suivez le lien vers le fichier original. Le producteur fournit une archive ZIP, même si le format indiqué est CSV. CanQuery propose actuellement le téléchargement de cette archive; son lecteur de tableaux ne charge pas directement les fichiers ZIP.

Pourquoi utiliser le fichier anglais dans ce guide français? Lors de la vérification du 11 septembre 2026, l’adresse de l’archive française renvoyait un fichier vide. L’exemple utilise donc l’archive anglaise effectivement vérifiée. Si vous avez besoin de libellés français, consultez les [options de téléchargement du tableau français officiel](https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=3510000701) et vérifiez que l’archive reçue contient bien des fichiers. Changer la langue de CanQuery ne traduit pas un CSV anglais.

## Extraire les données et les métadonnées

L’archive anglaise contient `35100007.csv` et `35100007_MetaData.csv`. Extrayez les deux fichiers et gardez-les ensemble. Utilisez la fonction d’importation texte/CSV de votre tableur, vérifiez le séparateur et l’encodage dans l’aperçu, puis conservez les colonnes d’identifiants sous forme de texte lorsque nécessaire. Une ouverture automatique peut transformer des codes ou des dates sans que vous l’ayez demandé.

Gardez une copie intacte de l’archive. Travaillez dans une copie distincte et notez la langue, la date du téléchargement et les filtres appliqués. Ces informations permettent de reproduire un extrait lorsque le tableau est diffusé à nouveau ou qu’une sélection change.

## Lire les dimensions avant de comparer les valeurs

Dans le fichier anglais, `REF_DATE`, `GEO`, `DGUID`, `Sex`, `Indigenous identity` et `Correctional services` décrivent la période, la géographie et les catégories d’une observation. Choisissez la combinaison voulue avant de comparer `VALUE`. Additionner des catégories détaillées avec leur total peut compter plusieurs fois la même activité.

Consultez `UOM` et `SCALAR_FACTOR` pour comprendre l’unité et l’échelle. Gardez `VECTOR` et `COORDINATE` si vous devez retrouver une série ou une observation. Ces identifiants ne remplissent pas le même rôle que la valeur numérique analysée. Les définitions et notes du tableau, ainsi que le fichier de métadonnées, servent à déterminer quelles catégories sont comparables.

## Conserver les indicateurs de statut

Le CSV comprend aussi `STATUS`, `SYMBOL`, `TERMINATED` et `DECIMALS`. Référez-vous aux métadonnées du producteur pour interpréter les indicateurs présents. Une valeur vide, indisponible ou assortie d’un indicateur ne doit pas automatiquement être remplacée par zéro. Conservez ces colonnes dans votre fichier de travail, même si votre graphique final affiche moins de champs.

Ce guide explique le choix et la structure des fichiers sans tirer de conclusion sur les admissions aux services correctionnels. Pour les définitions, la couverture et les notes de diffusion, revenez au [tableau officiel](https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=3510000701). Avec un extrait partagé, indiquez le tableau 35-10-0007, les périodes de référence et dimensions retenues, la langue de l’archive et la date du téléchargement.
