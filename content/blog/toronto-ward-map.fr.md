Vous voulez savoir dans lequel des 25 quartiers de Toronto se trouve une adresse, qui en est le conseiller ou comment joindre son bureau. La Ville de Toronto publie les limites des quartiers dans deux jeux de données ouvertes : **City Wards**, avec les fichiers des limites, et **Wards and Elected Councillors**, qui ajoute pour chaque quartier son conseiller avec un numéro de téléphone, une adresse courriel et un lien vers la page du conseiller. CanQuery présente le second sous forme de carte interactive et de table en direct.

| En bref | |
|---|---|
| Producteur | Ville de Toronto, Bureau du greffier municipal |
| Quartiers | 25, en vigueur depuis le 1er décembre 2018 |
| Champs du quartier | **WARD_NUMBER** et **AREA_NAME**, par exemple Toronto Centre, quartier 13 |
| Champs du conseiller | **COUNCILLOR**, **PHONE_NUMBER**, **EMAIL_ADDRESS** et **URL_LINK** |
| Enregistrement | **DATE_EFFECTIVE** 2025-04-16 sur chaque ligne : le conseil en poste avant l’élection du 26 octobre 2026 |
| Dans CanQuery | Une carte interactive et une table en direct de 25 lignes que vous pouvez chercher, trier et exporter en CSV |

Les noms des champs et des quartiers sont ceux de la Ville, en anglais.

## Trouver votre quartier sur la carte

1. [Ouvrez la carte des quartiers de Toronto dans CanQuery](/resources/ckan-toronto-open-data-resource-c76c2711-9e1e-4da4-8245-9ce3bb089a4b?view=map). Chaque polygone est un quartier.
2. Zoomez sur votre rue; le fond de carte indique les noms de rues.
3. Sélectionnez le quartier qui couvre votre adresse et lisez **AREA_NAME** et **WARD_NUMBER**. **AREA_DESC** les réunit, comme dans « Toronto Centre (13) ».

Près d’une limite, zoomez davantage avant de conclure. Si vous ne pouvez toujours pas trancher, la page [Members of Council](https://www.toronto.ca/city-government/council/members-of-council/) de la Ville propose une recherche par adresse qui donne le quartier et son conseiller.

## Trouver votre conseiller

1. Passez la même ressource en [vue tableau](/resources/ckan-toronto-open-data-resource-c76c2711-9e1e-4da4-8245-9ce3bb089a4b). Elle compte une ligne par quartier.
2. Cherchez le nom du quartier ou filtrez **WARD_NUMBER**, puis lisez **COUNCILLOR**, **PHONE_NUMBER** et **EMAIL_ADDRESS**.
3. **URL_LINK** ouvre la page du conseiller sur toronto.ca, avec les adresses de ses bureaux, ses numéros de téléphone et son courriel.

Lisez les champs du conseiller avec leur date. Chaque ligne porte **DATE_EFFECTIVE** 2025-04-16 : la table nomme donc les conseillers qui occupaient les sièges avant l’élection municipale du 26 octobre 2026. Le conseil élu ce jour-là entre en fonction le 15 novembre 2026, et le Bureau du greffier municipal met le jeu de données à jour à mesure que l’information devient disponible. Tant qu’une table plus récente n’est pas publiée, cherchez votre adresse sur la page [Members of Council](https://www.toronto.ca/city-government/council/members-of-council/) avant d’écrire à un conseiller.

## Télécharger les limites des quartiers

Le [jeu de données City Wards](/datasets/toronto-open-data-city-wards) contient les fichiers des limites. Sa table **City Wards Data** compte une ligne par quartier avec la géométrie, et ses fichiers ZIP contiennent le modèle à 25 quartiers en latitude et longitude WGS84 pour les logiciels SIG. La description de la Ville précise que les 25 quartiers suivent les circonscriptions électorales provinciales, avec de légers ajustements pour tenir compte des limites de Toronto, et sont en vigueur depuis le 1er décembre 2018.

Le même jeu de données conserve deux anciens modèles pour les travaux historiques : les 44 quartiers en vigueur jusqu’au 30 novembre 2018, en versions MTM et WGS84, et les 47 quartiers issus de l’examen antérieur des limites des quartiers de la Ville. Utilisez les fichiers à 25 quartiers pour toute adresse actuelle.

## Comparer les quartiers

Le jeu de données [Ward Profiles (25-Ward Model)](/datasets/toronto-open-data-ward-profiles-25-ward-model) décrit la population et les ménages de chaque quartier à partir des recensements de 2021, 2016 et 2011. C’est là qu’il faut comparer les quartiers; les couches de limites n’enregistrent que les territoires et leurs conseillers.

## Vérifier la source officielle

Les pages [Wards and Elected Councillors](https://open.toronto.ca/dataset/wards-and-elected-councillors/) et [City Wards](https://open.toronto.ca/dataset/city-wards/) de la Ville de Toronto donnent les descriptions, la licence et les téléchargements originaux. Les questions sur un conseiller ou un quartier relèvent de la Ville; CanQuery fournit la carte, la table et les liens vers la source. Les autres municipalités de l’Ontario sont présentées dans [Cartes des quartiers de l’Ontario 2026](/fr/blog/cartes-quartiers-ontario), et la [page de Toronto](/places/toronto-on) répertorie les autres données ouvertes de la Ville.

Quand vous partagez un résultat, indiquez la [page du jeu de données dans CanQuery](/datasets/toronto-open-data-wards-and-elected-councillors), le quartier et la date de votre consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Toronto](https://open.toronto.ca/open-data-licence/).
