You want to know how busy a Calgary road is: the daily traffic on a commute, a comparison between two routes or the volume on the street outside a school. The City of Calgary publishes a **Traffic Volumes** dataset for each survey year. This guide uses **Traffic Volumes for 2023**; the same steps apply to the other years.

## Explore the traffic flow map

1. [Open the 2023 traffic volumes map in CanQuery](/resources/socrata-calgary-open-data-resource-bjag-w7zi?view=map). Each line is a road segment surveyed by the City.
2. Zoom to the road you care about and select a segment. The record shows **SECTION_NAME** (the road and the stretch between two cross streets), **VOLUME**, **YEAR** and **COLLECTION**.
3. Switch to the table view to search a road by name. Type `Deerfoot` or `16 Avenue` in the search box to list every surveyed segment with that name, then sort by **VOLUME** to find the busiest stretch.
4. Chart or export the filtered rows. The CSV export is limited to 10,000 rows, which covers a full year's segments.

The table is prepared the first time someone opens it; later visits use the prepared copy.

## Read a volume correctly

The City describes **VOLUME** as the Average Daily Weekday Traffic (ADWT): the average number of vehicles in 24 hours, adjusted for seasonal variation, representing an average weekday, and counted in **both directions combined**. Volumes on provincial roads are supplied by Alberta Transportation as a weighted annual average daily traffic figure, so compare them with city-counted segments carefully.

A segment's volume reflects the conditions of its survey year, including construction, detours and operating conditions in place at the time. The City publishes the map as a general representation of traffic across the city, not as a guarantee for a specific day. Keep **YEAR** and **COLLECTION** with any number you quote.

## Compare years

CanQuery lists a traffic volumes dataset for each year the City has published, including [2024](/datasets/calgary-open-data-cauu-7hnw), [2022](/datasets/calgary-open-data-57me-rcwr) and [2019](/datasets/calgary-open-data-qeqv-tb2c). Segments are not guaranteed to match from one year to the next, so compare the **SECTION_NAME** text and the map geometry before treating two numbers as the same stretch of road.

## Check the official source

The [City of Calgary's dataset page](https://data.calgary.ca/d/bjag-w7zi) carries the City's description, licence and attachments. Questions about how a count was taken belong with the City; CanQuery provides the map, the table and the link back to the source.

The [Calgary place page](/places/calgary-ab) lists the City's other open data. When you share a finding, include the [CanQuery dataset page](/datasets/calgary-open-data-bjag-w7zi), the survey year and the date you consulted it.

Contains information licensed under the [Open Government Licence – City of Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).
