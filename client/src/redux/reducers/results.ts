import { type AppThunk } from "@/redux/index";
import { setStatesAndCounties } from "@/redux/reducers/monthlyEmissions";
import { setDownloadData } from "@/redux/reducers/downloads";
import {
  type EmissionsChanges,
  type EmissionsFlagsField,
  type CombinedSectorsEmissionsData,
  calculateAggregatedEmissionsData,
  createCombinedSectorsEmissionsData,
} from "@/calculations/emissions";
import { type EmptyObject } from "@/utilities";
import { type RegionId, regions } from "@/config";

export type EgusNeeingEmissionsReplacement = ReturnType<typeof setEgusNeedingEmissionsReplacement>; // prettier-ignore
export type EmissionsReplacements = ReturnType<typeof setEmissionsReplacements>;

type Action =
  | { type: "results/RESET_RESULTS" }
  | { type: "results/FETCH_EMISSIONS_CHANGES_REQUEST" }
  | {
      type: "results/FETCH_EMISSIONS_CHANGES_SUCCESS";
      payload: { emissionsChanges: EmissionsChanges };
    }
  | { type: "results/FETCH_EMISSIONS_CHANGES_FAILURE" }
  | {
      type: "results/SET_COMBINED_SECTORS_EMISSIONS_DATA";
      payload: { combinedSectorsEmissionsData: CombinedSectorsEmissionsData };
    }
  | {
      type: "results/SET_EGUS_NEEDING_EMISSIONS_REPLACEMENT";
      payload: {
        egusNeedingEmissionsReplacement: EgusNeeingEmissionsReplacement;
      };
    }
  | {
      type: "results/SET_EMISSIONS_REPLACEMENTS";
      payload: { emissionsReplacements: EmissionsReplacements };
    };

type State = {
  emissionsChanges:
    | { status: "idle"; data: EmptyObject }
    | { status: "pending"; data: EmptyObject }
    | { status: "success"; data: EmissionsChanges }
    | { status: "failure"; data: EmptyObject };
  combinedSectorsEmissionsData: CombinedSectorsEmissionsData;
  egusNeedingEmissionsReplacement: EgusNeeingEmissionsReplacement;
  emissionsReplacements: EmissionsReplacements | EmptyObject;
};

const initialState: State = {
  emissionsChanges: {
    status: "idle",
    data: {},
  },
  combinedSectorsEmissionsData: null,
  egusNeedingEmissionsReplacement: {},
  emissionsReplacements: {},
};

export default function reducer(
  state: State = initialState,
  action: Action,
): State {
  switch (action.type) {
    case "results/RESET_RESULTS": {
      return initialState;
    }

    case "results/FETCH_EMISSIONS_CHANGES_REQUEST": {
      return {
        ...initialState,
        emissionsChanges: {
          status: "pending",
          data: {},
        },
      };
    }

    case "results/FETCH_EMISSIONS_CHANGES_SUCCESS": {
      const { emissionsChanges } = action.payload;
      return {
        ...state,
        emissionsChanges: {
          status: "success",
          data: emissionsChanges,
        },
      };
    }

    case "results/FETCH_EMISSIONS_CHANGES_FAILURE": {
      return {
        ...state,
        emissionsChanges: {
          status: "failure",
          data: {},
        },
      };
    }

    case "results/SET_COMBINED_SECTORS_EMISSIONS_DATA": {
      const { combinedSectorsEmissionsData } = action.payload;
      return {
        ...state,
        combinedSectorsEmissionsData,
      };
    }

    case "results/SET_EGUS_NEEDING_EMISSIONS_REPLACEMENT": {
      const { egusNeedingEmissionsReplacement } = action.payload;
      return {
        ...state,
        egusNeedingEmissionsReplacement,
      };
    }

    case "results/SET_EMISSIONS_REPLACEMENTS": {
      const { emissionsReplacements } = action.payload;
      return {
        ...state,
        emissionsReplacements,
      };
    }

    default: {
      return state;
    }
  }
}

/**
 * Called every time the "Back to Energy Impacts" button or the "Reselect
 * Geography" button is clicked on the "Get Results" page.
 */
export function resetResults(): Action {
  return { type: "results/RESET_RESULTS" };
}

/**
 * Called every time the "Get Results" button is clicked on the "Set Energy
 * Impacts" page.
 */
export function fetchEmissionsChanges(): AppThunk {
  return (dispatch, getState) => {
    const { api, transportation, impacts } = getState();
    const {
      selectedRegionsTotalMonthlyEmissionChanges,
      vehicleEmissionChangesByGeography,
    } = transportation;
    const { hourlyEnergyProfile } = impacts;

    dispatch({ type: "results/FETCH_EMISSIONS_CHANGES_REQUEST" });

    // build up requests for selected regions
    const requests: Promise<Response>[] = [];

    for (const regionId in hourlyEnergyProfile.data.regions) {
      const regionalProfile = hourlyEnergyProfile.data.regions[regionId as RegionId]; // prettier-ignore

      if (regionalProfile) {
        const hourlyChanges = Object.values(regionalProfile.hourlyImpacts).map(
          (d) => d.impactsLoad,
        );

        requests.push(
          fetch(`${api.baseUrl}/api/v1/emissions`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ regionId, hourlyChanges }),
          }),
        );
      }
    }

    // request all data for selected regions in parallel
    Promise.all(requests)
      .then((responses) => Promise.all(responses.map((res) => res.json())))
      .then((regionsData: EmissionsChanges[]) => {
        // flatten array of regionData objects into a single object
        const emissionsChanges = regionsData.reduce((result, regionData) => {
          return { ...result, ...regionData };
        }, {});

        const aggregatedEmissionsData =
          calculateAggregatedEmissionsData(emissionsChanges);

        // prettier-ignore
        const combinedSectorsEmissionsData = createCombinedSectorsEmissionsData({
          aggregatedEmissionsData,
          selectedRegionsTotalMonthlyEmissionChanges,
          vehicleEmissionChangesByGeography,
        });

        const egusNeedingEmissionsReplacement =
          setEgusNeedingEmissionsReplacement(emissionsChanges);

        const emissionsReplacements = setEmissionsReplacements(
          egusNeedingEmissionsReplacement,
        );

        dispatch({
          type: "results/FETCH_EMISSIONS_CHANGES_SUCCESS",
          payload: { emissionsChanges },
        });

        dispatch({
          type: "results/SET_COMBINED_SECTORS_EMISSIONS_DATA",
          payload: { combinedSectorsEmissionsData },
        });

        dispatch({
          type: "results/SET_EGUS_NEEDING_EMISSIONS_REPLACEMENT",
          payload: { egusNeedingEmissionsReplacement },
        });

        dispatch({
          type: "results/SET_EMISSIONS_REPLACEMENTS",
          payload: { emissionsReplacements },
        });

        dispatch(setStatesAndCounties());
        dispatch(setDownloadData());
      })
      .catch((_err) => {
        dispatch({ type: "results/FETCH_EMISSIONS_CHANGES_FAILURE" });
      });
  };
}

/**
 * An EGU is marked as needing emissions "replacement" if it's `emissionsFlag`
 * array isn't empty. In calculating the emissions changes (via the server app's
 * `calculateEmissionsChanges()` function), a pollutant that needs replacement
 * will have the `infreq_emissions_flag` property's value of 1 for the given
 * given in the region's RDF.
 */
function setEgusNeedingEmissionsReplacement(egus: EmissionsChanges) {
  if (Object.keys(egus).length === 0) return {};

  const result = Object.entries(egus).reduce((object, [eguId, eguData]) => {
    if (eguData.emissionsFlags.length !== 0) {
      object[eguId] = eguData;
    }

    return object;
  }, {} as EmissionsChanges);

  return result;
}

/**
 * Build up emissions replacement values for each pollutant from provided EGUs
 * needing emissions replacement, and the region's actual emissions value for
 * that particular pollutant.
 */
function setEmissionsReplacements(egus: EmissionsChanges) {
  if (Object.keys(egus).length === 0) {
    return {} as { [pollutant in EmissionsFlagsField]: number };
  }

  const replacementsByRegion = Object.values(egus).reduce(
    (object, egu) => {
      const regionId = egu.region as RegionId;

      egu.emissionsFlags.forEach((pollutant) => {
        object[pollutant] ??= {};
        object[pollutant][regionId] = regions[regionId].actualEmissions[pollutant]; // prettier-ignore
      });

      return object;
    },
    {} as {
      [pollutant in EmissionsFlagsField]: Partial<{
        [regionId in RegionId]: number;
      }>;
    },
  );

  const result = Object.entries(replacementsByRegion).reduce(
    (object, [key, regionData]) => {
      const pollutant = key as EmissionsFlagsField;
      object[pollutant] = Object.values(regionData).reduce((a, b) => (a += b));
      return object;
    },
    {} as { [pollutant in EmissionsFlagsField]: number },
  );

  return result;
}
