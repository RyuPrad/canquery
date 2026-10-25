You want to check how a Surrey restaurant did in its recent health inspections before you eat there, or compare inspection results across the city. Fraser Health's environmental health officers inspect food premises in Surrey, and the City of Surrey publishes two tables drawn from Fraser Health's inspection data: a list of restaurants with their addresses, and one row per inspection with its hazard rating and violations. CanQuery shows the restaurants on a map and both lists as tables.

| At a glance | |
|---|---|
| Inspections by | Fraser Health |
| Published by | City of Surrey, as open data |
| Restaurants | 2,574 Surrey restaurants with name, address and a tracking number |
| Inspection reports | 11,900 inspections from July 25, 2022 to April 27, 2026 |
| Link between the two | **TRACKINGNUMBER**, such as `HCAR-CCUMZL` |
| On CanQuery | A map of the restaurants, two searchable tables and CSV export of up to 10,000 rows |

## Find the restaurant

1. [Open the map of Surrey restaurants in CanQuery](/resources/arcgis-7901c9e7847a441a8e0a0964724240bb-0-data?view=map). Each point is a restaurant; the City of Surrey's GIS section added the coordinates to Fraser Health's records.
2. Zoom to a street, or switch to the table view and type the restaurant's name or street in the search box. The table lists **NAME**, **PHYSICALADDRESS**, **PHYSICALCITY** and **FACTYPE**.
3. Note the restaurant's **TRACKINGNUMBER**. It identifies the restaurant in the inspection reports.

## Read its inspections

1. [Open the Fraser Health inspection reports table](/resources/arcgis-320cec8503034bb997d8f6e57690dd5d-0-data). It holds one row per inspection and no restaurant names, so search it by tracking number.
2. Enter the tracking number with a leading `=`, such as `=HCAR-CCUMZL`, in the **TRACKINGNUMBER** column filter. The `=` selects an exact match.
3. Read each row:
   - **INSPECTIONDATE** is the date as a number in year, month, day order: `20220725` is July 25, 2022.
   - **INSPTYPE** is `Routine` or `Follow-Up`.
   - **NUMCRITICAL** and **NUMNONCRITICAL** count the critical and non-critical violations found.
   - **HAZARDRATING** is the inspection's rating: `Low`, `Moderate` or `High`.
   - **VIOLLUMP** lists the violations, separated by `|`. Each one gives a code, whether it is critical, a description that cites the section of the regulation, and whether it was a repeat.
4. Sort by **INSPECTIONDATE** to see the most recent inspection first.

To compare the city as a whole, filter **HAZARDRATING** with `=High`, or chart the ratings: of the 11,900 inspections, 10,126 were rated Low, 1,104 Moderate and 661 High.

## Read the results carefully

Fraser Health explains that the hazard rating is normally the sum of all violations found at the inspection, and that an inspector may change it depending on how serious a condition is; a High rating means a significant increase in the risk of foodborne illness. Inspections check food handling, the temperature control of food, the maintenance and sanitation of the premises and employee hygiene, and they happen on a routine basis and when complaints are received.

An inspection result is valid only for the day of the inspection, and Fraser Health cautions against judging a restaurant on a single report, so read a restaurant's inspections together and in date order. A restaurant with no inspection rows may be new, closed or recorded under another tracking number.

The tables cover restaurants in Surrey only, while Fraser Health inspects food premises in some 20 municipalities from Burnaby to Boston Bar. The newest inspection in the City's copy is from April 27, 2026.

## Check the official source

Fraser Health is the authority on any inspection. Its page on [food facilities inspection reports](https://www.fraserhealth.ca/health-topics-a-to-z/food-safety/food-facilities-inspection-reports-and-violation-tickets) links to the full reports, which add the inspector's observations and corrective actions. The City of Surrey's open data portal publishes [the restaurant list](https://opendata-surrey.hub.arcgis.com/datasets/surrey::restaurants) and [the inspection reports](https://opendata-surrey.hub.arcgis.com/datasets/surrey::fraser-health-restaurant-inspection-reports); check the terms shown on each dataset page before reusing the data.

## Continue exploring Surrey

The [Surrey place page](/places/surrey-bc) lists the City's other open datasets. When you share a finding, include the [CanQuery dataset page](/datasets/arcgis-320cec8503034bb997d8f6e57690dd5d-0), the restaurant's tracking number and the date you consulted it.
