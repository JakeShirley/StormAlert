import Parser from "rss-parser";
import neatCsv from "neat-csv";
import fsSync from "fs";
const fs = fsSync.promises;

// Found here: https://www.weather.gov/gis/ZoneCounty
const UgcCsvHeaders = [
  "state",
  "zone",
  "cwa",
  "name",
  "stateZone",
  "county",
  "fips",
  "timeZone",
  "feArea",
  "latitude",
  "longitude",
];

// Found here: https://www.weather.gov/source/nwr/SameCode.txt
const CountyCsvHeaders = ["fips", "name", "state"];

let parser = new Parser({
  customFields: {
    //feed: ['otherTitle', 'extendedDescription'],
    item: [
      ["cap:event", "capevent"],
      ["cap:effective", "capeffective"],
      ["cap:expires", "capexpires"],
      ["cap:status", "capstatus"],
      ["cap:msgType", "capmsgType"],
      ["cap:category", "capcategory"],
      ["cap:urgency", "capurgency"],
      ["cap:severity", "capseverity"],
      ["cap:certainty", "capcertainty"],
      ["cap:areaDesc", "capareaDesc"],
      ["cap:polygon", "cappolygon", { keepArray: true }],
      ["cap:geocode", "capgeocode", { keepArray: true }],
      ["cap:parameter", "capparameter", { keepArray: true }],
    ],
  },
});

const FIPSStateCodes = {
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
  AS: "60",
  GU: "66",
  MP: "69",
  PR: "72",
  UM: "74",
  VI: "78",
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
};

function padFips(fipsCode: string) {
  if (fipsCode.length == 5) {
    return `0${fipsCode}`;
  }
  return fipsCode;
}

const AlertTerms = [/((?:(and\s+)|,|\.)([a-zA-Z0-9 ]+))?(hail|HAIL)/];

(async () => {
  // Load UGC data
  const ugcRawData = await fs.readFile("data/zones.csv");
  const ugcParsedData = await neatCsv(ugcRawData, { separator: "|", headers: UgcCsvHeaders });
  const ugcEntriesByZone = Object.assign({}, ...ugcParsedData.map((x) => ({ [`${x.state}Z${x.zone}`]: x })));

  // Load county data
  const countyRawData = await fs.readFile("data/counties.csv");
  const countyParsedData = await neatCsv(countyRawData, { separator: ",", headers: CountyCsvHeaders });
  const ugcEntriesByCounty = Object.assign({}, ...countyParsedData.map((x) => ({ [padFips(x.fips)]: x })));

  // National
  const nationalRssFeedURI = "https://alerts.weather.gov/cap/us.php?x=0";

  let feed = await parser.parseURL(nationalRssFeedURI);
  console.log(feed.title);

  feed.items.forEach((item) => {
    const affectedRegions = [];

    ///
    // UGC codes
    ///
    if (item.capgeocode.length == 1) {
      if (item.capgeocode[0].valueName[1] == "UGC") {
        const affectedFIPS6Regions = item.capgeocode[0].value[1].split(" ");
        for (let affectedRegion of affectedFIPS6Regions) {
          let ugcZone = null;
          let ugcCounty = null;

          if (affectedRegion[2] == "Z") {
            ugcZone = ugcEntriesByZone[affectedRegion];

            if (ugcZone == null) {
              ugcZone = {
                name: `Unknown Zone (${affectedRegion})`,
                state: affectedRegion.slice(0, 2),
              };
            }
          } else if (affectedRegion[2] == "C") {
            const stateCode = affectedRegion.slice(0, 2);
            const countyCode = affectedRegion.slice(3);
            const fipsCode = `0${FIPSStateCodes[stateCode]}${countyCode}`;

            ugcCounty = ugcEntriesByCounty[fipsCode];

            if (ugcCounty == null) {
              ugcCounty = {
                name: `Unknown County (${affectedRegion})`,
                state: affectedRegion.slice(0, 2),
              };
            }
          } else {
            console.error(
              `UGC region code '${affectedRegion} was not recoginized, third character should be Z (zone) or C (county). Skipping in affected areas.\n  Link: ${item.link}`
            );
            continue;
          }
          // const ugcCounty = ugcEntriesByCounty[affectedRegion];
          if (ugcZone != null) {
            affectedRegions.push(ugcZone);
          } else if (ugcCounty != null) {
            affectedRegions.push(ugcCounty);
          } else {
            console.error(
              `Did not recognize UGC region '${affectedRegion}' as zone or county, skipping in affected areas.\n  Link: ${item.link}`
            );
          }
        }
      } else {
        console.error(
          `Did not recognize geocoding of type '${item.capgeocode[0].valueName[1]}, skipping affected regions'`
        );
      }
    }

    const keyTermsFound = [];
    const splitSummary = item.summary.split("...");

    for (let summaryLine of splitSummary) {
      for (let searchTerm of AlertTerms) {
        const regexResult = searchTerm.exec(summaryLine);
        if (regexResult != null) {
          keyTermsFound.push(`${regexResult[3]}${regexResult[4]}`.trim());
        }
      }
    }

    if (keyTermsFound.length > 0) {
      try {
        console.log(
          `Potential Event:\n\tTerms: ${keyTermsFound.map((x) => `"${x}"`).join(", ")}\n\tDescription: ${
            item.summary
          }\n\tAffected Areas: ${affectedRegions.map((x) => `${x.name} (${x.state.trim()})`).join(", ")}\n\tLink: ${
            item.link
          }\n`
        );
      } catch (e) {
        console.error(`Failed to serialize affected regions: ${e}`);
      }
    }
  });
})();
