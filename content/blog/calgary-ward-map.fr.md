Vous voulez savoir à quel quartier électoral (ward) de Calgary appartient une adresse, qui représente ce quartier au conseil ou comment les 14 quartiers se comparent en logements et en résidents. La Ville de Calgary publie ses limites de quartiers en données ouvertes, avec un jeu distinct pour chaque découpage. Ce guide utilise **Ward Boundaries for 2021 October 18 General Election**, les limites entrées en vigueur le jour de l’élection de 2021.

| En bref | |
|---|---|
| Producteur | Ville de Calgary |
| Limites | 14 quartiers, tels que fixés pour l’élection générale du 18 octobre 2021 |
| Champ du quartier | **WardNumber** |
| Aussi joints | Des totaux du recensement municipal, comme **SUM_RES_CNT** (résidents) et **SUM_DWELL_CNT** (logements) |
| Dans CanQuery | Une carte interactive et une table à représenter en graphique ou à exporter en CSV |

## Trouver un quartier sur la carte

1. [Ouvrez la carte des quartiers électoraux de Calgary dans CanQuery](/resources/socrata-calgary-open-data-resource-bxgr-t8xb?view=map). Chaque polygone est un quartier.
2. Zoomez sur une adresse et sélectionnez le polygone qui la couvre. Le champ **WardNumber** du dossier indique le quartier.
3. Passez à la vue tableau pour comparer les quartiers. La Ville a joint à chaque limite des totaux du recensement municipal : **SUM_RES_CNT** (résidents), **SUM_DWELL_CNT** (logements) et des comptes par type de bâtiment comme **SUM_SING_FAMLY**, **SUM_DUPLEX**, **SUM_APARTMENT** et **SUM_TOWN_HOUSE**, suivis de colonnes par groupe d’âge comme **SUM_MF_0_4**.
4. Tracez un graphique d’une colonne sur les 14 lignes, ou exportez le tableau en CSV pour le reprendre ailleurs.

Le tableau compte 14 lignes et est préparé lors de la première ouverture. Les noms de colonnes restent en anglais, leur langue de publication.

## Lire les champs

Les totaux de recensement joints aux limites proviennent du recensement municipal tel qu’il existait à la publication de la couche; ils facilitent la comparaison des quartiers mais ne constituent pas un décompte actuel de la population. Les jeux du recensement municipal, comme [Civic Census by Ward and Dwelling Structure](/datasets/calgary-open-data-yr3w-mcsu), portent l’année et sont la meilleure source pour un chiffre que vous comptez citer.

Une limite de quartier indique le quartier électoral municipal, qui sert aussi de base aux listes de communautés par quartier de la Ville. Elle n’indique ni l’association communautaire, ni le bassin scolaire, ni la circonscription fédérale ou provinciale : ces limites sont publiées séparément.

## Choisir le bon découpage

La Ville publie plusieurs jeux de limites de quartiers. [Ward Boundaries 2017–2021](/datasets/calgary-open-data-au4g-xjwh) et [Ward Boundaries 2013–2017](/datasets/calgary-open-data-mjit-gete) décrivent les mandats antérieurs; un jeu général [Ward Boundaries](/datasets/calgary-open-data-tz8z-hyaz) est aussi répertorié. Vérifiez le titre de chaque jeu et la description de la Ville avant d’utiliser une limite pour une date passée, et considérez la date du catalogue comme une date de fiche plutôt que comme la date d’un changement de limite.

## Vérifier la source officielle

La [page du jeu de données de la Ville de Calgary](https://data.calgary.ca/d/bxgr-t8xb) présente la description et la licence. Les questions sur la représentation d’un quartier relèvent de la Ville; CanQuery fournit la carte, le tableau et le lien vers la source.

## Poursuivre votre recherche à Calgary

La [page de Calgary](/places/calgary-ab) répertorie les autres jeux de données ouverts de la Ville, dont les [permis de construction](/fr/blog/carte-permis-construction-calgary) et les [volumes de circulation](/fr/blog/volumes-circulation-calgary) que vous pouvez lire par quartier. Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/calgary-open-data-bxgr-t8xb), le découpage utilisé et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Ville de Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).
