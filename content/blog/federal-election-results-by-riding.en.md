You want the official result of a federal election in your riding: who was elected, by how many votes, the turnout and every candidate's share. Elections Canada publishes the **Official Voting Results** of each general election as a set of CSV tables on the Government of Canada's open data portal. This guide uses the **44th General Election** (September 20, 2021); the tables for the 43rd and 42nd general elections follow the same layout.

## Find your riding's result

1. [Open Table 11, voting results by electoral district, in CanQuery](/resources/d9ff2144-4591-4ef5-b313-be5012eca3be). It has one row per electoral district (338 for the 44th general election) with **Province**, **Electoral District Name**, **Electoral District Number**, **Population**, **Electors**, **Polling Stations**, **Valid Ballots**, **Rejected Ballots**, **Total Ballots Cast**, **Percentage of Voter Turnout** and **Elected Candidate**.
2. Type the riding's name, or a city, in the search box. Riding names are bilingual in the file, so `Gatineau` and `Ottawa` both match their rows.
3. For the full candidate list, [open Table 12](/resources/8d6380a6-c1a3-4a19-b2ca-df0228ab4ddd) and search the same riding. Each row is a candidate with **Votes Obtained**, **Percentage of Votes Obtained**, **Majority** and **Majority Percentage** for the winner, plus the candidate's residence and occupation as recorded by Elections Canada.
4. Sort **Percentage of Voter Turnout** to compare ridings, chart a column across a province, or export either table as CSV. Both tables are small and well under the 10,000-row export limit.

Both tables are live tables read from the portal's DataStore, so there is no preparation step. Column headings carry the English and French labels together, separated by a slash.

## Read the tables correctly

Table 11 reports **valid**, **rejected** and **total** ballots separately. Turnout is total ballots cast divided by electors on the lists, so it is not the same as the share of the voting-age population. **Majority** in Table 12 is the winner's margin over the second-placed candidate, in votes and in percentage points.

The candidate's political affiliation is part of the **Candidate** field in this table, as published by Elections Canada. Compare candidates within one riding; comparing vote totals between ridings of different sizes says little without the electors count from Table 11.

## Other tables and elections

The dataset's other tables summarize the same election: electors and polling stations (Table 1), turnout across the 2021, 2019, 2015 and 2011 elections (Table 4), votes by voting method (Table 5) and seats by political affiliation (Table 7). The [43rd General Election](/datasets/199e5070-2fd5-49d3-aa21-aece08964d18) (2019) and the [42nd General Election](/datasets/775f3136-1aa3-4854-a51e-1a2dab362525) (2015) datasets use the same table numbers. Poll-by-poll results are published as [separate datasets](/datasets/d5512235-cfb2-4ccf-a886-547913f4aa52).

Electoral district boundaries changed after the 2022 representation order, so a riding name in these tables may not match the riding you vote in today.

## Check the official source

The [Government of Canada's dataset page](https://open.canada.ca/data/en/dataset/065439a9-c194-4259-9c95-245a852be4a1) carries Elections Canada's description and the original files. The catalogue date describes a change to the listing, not a change to the results, which are final. Questions about the administration of an election belong with Elections Canada.

When you share a finding, include the [CanQuery dataset page](/datasets/065439a9-c194-4259-9c95-245a852be4a1), the table number and the date you consulted it.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
