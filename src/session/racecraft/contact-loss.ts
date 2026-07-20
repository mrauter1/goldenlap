export interface MeasuredContactLossPoint {
  readonly relativeNormalSpeedMetresPerSecond: number;
  readonly recoverySeconds: number;
  readonly secondsLost: number;
}

export interface MeasuredContactGrindLossPoint {
  readonly durationSeconds: number;
  readonly additionalSecondsLost: number;
}

export interface MeasuredContactEpisodeLossBound {
  readonly lowerBoundSeconds: number;
  readonly exact: boolean;
}

export const MEASURED_CONTACT_LOSS_PROVENANCE = Object.freeze({
  schemaVersion: 2 as const,
  method: "stable-car lateral strike versus identical no-contact control",
  physicsStepSeconds: 0.008333333333333333,
  referenceSpeedMetresPerSecond: 47.0400463163761,
  hardContactBoundaryMetresPerSecond: 16,
  maximumRelativeNormalSpeedMetresPerSecond:
    178,
  relativeNormalSpeedStepMetresPerSecond:
    1.7951962222222224,
  maximumMeasurementSeconds: 10.966743794411206,
  contactLateralSeparationMetres:
    1.5
});

/**
 * Raw deterministic output from tools/measure-contact-loss.ts across the full
 * physically reachable relative-normal-speed domain. Hard classification and
 * probability remain safety authorities; this curve supplies only physical
 * recovery loss.
 */
export const MEASURED_CONTACT_LOSS:
readonly MeasuredContactLossPoint[] = Object.freeze([
  { relativeNormalSpeedMetresPerSecond: 0, recoverySeconds: 0, secondsLost: 0 },
  { relativeNormalSpeedMetresPerSecond: 1.7951962222222224, recoverySeconds: 0.36946359271673557, secondsLost: 0.005054059579047088 },
  { relativeNormalSpeedMetresPerSecond: 3.590392444444445, recoverySeconds: 0.39767012150430825, secondsLost: 0.00539409012153641 },
  { relativeNormalSpeedMetresPerSecond: 5.385588666666667, recoverySeconds: 0.4423926813597343, secondsLost: 0.005933264931757609 },
  { relativeNormalSpeedMetresPerSecond: 7.18078488888889, recoverySeconds: 0.5014358650382531, secondsLost: 0.006644821081402741 },
  { relativeNormalSpeedMetresPerSecond: 8.975981111111112, recoverySeconds: 0.5720149234123287, secondsLost: 0.007521010693715802 },
  { relativeNormalSpeedMetresPerSecond: 10.771177333333334, recoverySeconds: 0.651293395648422, secondsLost: 0.008584593540643226 },
  { relativeNormalSpeedMetresPerSecond: 12.566373555555556, recoverySeconds: 0.7376138294472452, secondsLost: 0.009912834292198247 },
  { relativeNormalSpeedMetresPerSecond: 14.361569777777778, recoverySeconds: 0.8304533772601577, secondsLost: 0.011664122883037864 },
  { relativeNormalSpeedMetresPerSecond: 16, recoverySeconds: 0.9217697462314228, secondsLost: 0.013905068318728508 },
  { relativeNormalSpeedMetresPerSecond: 16.156766, recoverySeconds: 0.930879697512408, secondsLost: 0.014166570442378235 },
  { relativeNormalSpeedMetresPerSecond: 17.951962222222225, recoverySeconds: 1.0419197629303139, secondsLost: 0.0180879337113784 },
  { relativeNormalSpeedMetresPerSecond: 19.747158444444448, recoverySeconds: 1.1737097810336479, secondsLost: 0.025045338521426874 },
  { relativeNormalSpeedMetresPerSecond: 21.54235466666667, recoverySeconds: 1.3609547969523499, secondsLost: 0.04068714612434543 },
  { relativeNormalSpeedMetresPerSecond: 23.337550888888895, recoverySeconds: 1.8909067635318706, secondsLost: 0.1309713701296762 },
  { relativeNormalSpeedMetresPerSecond: 25.13274711111112, recoverySeconds: 3.9668599991010223, secondsLost: 1.6384407198211188 },
  { relativeNormalSpeedMetresPerSecond: 26.927943333333342, recoverySeconds: 3.7254965942765743, secondsLost: 1.4472501526365007 },
  { relativeNormalSpeedMetresPerSecond: 28.723139555555566, recoverySeconds: 3.6311850564969443, secondsLost: 1.3741578919226476 },
  { relativeNormalSpeedMetresPerSecond: 30.51833577777779, recoverySeconds: 3.5920475777703555, secondsLost: 1.3435547416514972 },
  { relativeNormalSpeedMetresPerSecond: 32.31353200000001, recoverySeconds: 3.568022793242485, secondsLost: 1.3222367566216842 },
  { relativeNormalSpeedMetresPerSecond: 34.10872822222223, recoverySeconds: 3.551167985018988, secondsLost: 1.3051687517882562 },
  { relativeNormalSpeedMetresPerSecond: 35.903924444444456, recoverySeconds: 3.538229980787796, secondsLost: 1.2904770644912205 },
  { relativeNormalSpeedMetresPerSecond: 37.69912066666668, recoverySeconds: 3.5271807363544756, secondsLost: 1.2769552057914395 },
  { relativeNormalSpeedMetresPerSecond: 39.4943168888889, recoverySeconds: 3.517043680826447, secondsLost: 1.2640484389905273 },
  { relativeNormalSpeedMetresPerSecond: 41.28951311111113, recoverySeconds: 3.5074231847877657, secondsLost: 1.2515526901734888 },
  { relativeNormalSpeedMetresPerSecond: 43.08470933333335, recoverySeconds: 3.4979259917477123, secondsLost: 1.2392727571194837 },
  { relativeNormalSpeedMetresPerSecond: 44.879905555555574, recoverySeconds: 3.488243775214714, secondsLost: 1.2270046973483684 },
  { relativeNormalSpeedMetresPerSecond: 46.6751017777778, recoverySeconds: 3.478224862924022, secondsLost: 1.214661970211122 },
  { relativeNormalSpeedMetresPerSecond: 48.47029800000002, recoverySeconds: 3.4687110140905255, secondsLost: 1.2024353318529766 },
  { relativeNormalSpeedMetresPerSecond: 50.265494222222245, recoverySeconds: 3.4656383799189108, secondsLost: 1.1924707458989654 },
  { relativeNormalSpeedMetresPerSecond: 52.06069044444447, recoverySeconds: 3.467250574199187, secondsLost: 1.1847813144350705 },
  { relativeNormalSpeedMetresPerSecond: 53.85588666666669, recoverySeconds: 3.472946755179454, secondsLost: 1.1794178818013017 },
  { relativeNormalSpeedMetresPerSecond: 55.651082888888915, recoverySeconds: 3.4816099870666863, secondsLost: 1.1758947964507263 },
  { relativeNormalSpeedMetresPerSecond: 57.44627911111114, recoverySeconds: 3.492356310211754, secondsLost: 1.1736518059189547 },
  { relativeNormalSpeedMetresPerSecond: 59.24147533333336, recoverySeconds: 3.50505993571067, secondsLost: 1.1726754801236101 },
  { relativeNormalSpeedMetresPerSecond: 61.036671555555586, recoverySeconds: 3.518923798067683, secondsLost: 1.1723500136131157 },
  { relativeNormalSpeedMetresPerSecond: 62.83186777777781, recoverySeconds: 3.5338144776235905, secondsLost: 1.172629377195808 },
  { relativeNormalSpeedMetresPerSecond: 64.62706400000003, recoverySeconds: 3.5493111608627594, secondsLost: 1.173180041320805 },
  { relativeNormalSpeedMetresPerSecond: 66.42226022222225, recoverySeconds: 3.5652418791919813, secondsLost: 1.173842128666374 },
  { relativeNormalSpeedMetresPerSecond: 68.21745644444447, recoverySeconds: 3.5816613113196807, secondsLost: 1.1746732114902705 },
  { relativeNormalSpeedMetresPerSecond: 70.01265266666668, recoverySeconds: 3.5987028617929915, secondsLost: 1.175786399637925 },
  { relativeNormalSpeedMetresPerSecond: 71.8078488888889, recoverySeconds: 3.616186501600935, secondsLost: 1.1769925865456985 },
  { relativeNormalSpeedMetresPerSecond: 73.60304511111111, recoverySeconds: 3.634466250975745, secondsLost: 1.178572776521246 },
  { relativeNormalSpeedMetresPerSecond: 75.39824133333333, recoverySeconds: 3.6534598977676875, secondsLost: 1.1804548181808525 },
  { relativeNormalSpeedMetresPerSecond: 77.19343755555555, recoverySeconds: 3.6730000630118234, secondsLost: 1.1824966133836599 },
  { relativeNormalSpeedMetresPerSecond: 78.98863377777776, recoverySeconds: 3.6933006938360915, secondsLost: 1.1848522465412086 },
  { relativeNormalSpeedMetresPerSecond: 80.78382999999998, recoverySeconds: 3.714427512177822, secondsLost: 1.1875623011669716 },
  { relativeNormalSpeedMetresPerSecond: 82.5790262222222, recoverySeconds: 3.7362378251627044, secondsLost: 1.1904848887935566 },
  { relativeNormalSpeedMetresPerSecond: 84.37422244444441, recoverySeconds: 3.7587658414661016, secondsLost: 1.1936675979342675 },
  { relativeNormalSpeedMetresPerSecond: 86.16941866666663, recoverySeconds: 3.7822680859922877, secondsLost: 1.1972621626749484 },
  { relativeNormalSpeedMetresPerSecond: 87.96461488888885, recoverySeconds: 3.8066148745391586, secondsLost: 1.2011726136445229 },
  { relativeNormalSpeedMetresPerSecond: 89.75981111111106, recoverySeconds: 3.8318109911240077, secondsLost: 1.2053870890619756 },
  { relativeNormalSpeedMetresPerSecond: 91.55500733333328, recoverySeconds: 3.8578204312270636, secondsLost: 1.2098671015526268 },
  { relativeNormalSpeedMetresPerSecond: 93.3502035555555, recoverySeconds: 3.884943480754029, secondsLost: 1.21483089892797 },
  { relativeNormalSpeedMetresPerSecond: 95.14539977777771, recoverySeconds: 3.912985531667372, secondsLost: 1.2201154058618586 },
  { relativeNormalSpeedMetresPerSecond: 96.94059599999993, recoverySeconds: 3.9416653723760935, secondsLost: 1.225487702735356 },
  { relativeNormalSpeedMetresPerSecond: 98.73579222222214, recoverySeconds: 3.971681391054259, secondsLost: 1.2314599128568804 },
  { relativeNormalSpeedMetresPerSecond: 100.53098844444436, recoverySeconds: 4.0024738930390855, secondsLost: 1.2376080631673116 },
  { relativeNormalSpeedMetresPerSecond: 102.32618466666658, recoverySeconds: 4.029107908999042, secondsLost: 1.243015703858338 },
  { relativeNormalSpeedMetresPerSecond: 104.1213808888888, recoverySeconds: 4.029501428570056, secondsLost: 1.2431001059961528 },
  { relativeNormalSpeedMetresPerSecond: 105.91657711111101, recoverySeconds: 4.02987848196898, secondsLost: 1.2431787879758671 },
  { relativeNormalSpeedMetresPerSecond: 107.71177333333323, recoverySeconds: 4.030239939275256, secondsLost: 1.2432522080280872 },
  { relativeNormalSpeedMetresPerSecond: 109.50696955555544, recoverySeconds: 4.030589362026281, secondsLost: 1.2433229049147925 },
  { relativeNormalSpeedMetresPerSecond: 111.30216577777766, recoverySeconds: 4.030926992459196, secondsLost: 1.2433908905778575 },
  { relativeNormalSpeedMetresPerSecond: 113.09736199999988, recoverySeconds: 4.031251076850067, secondsLost: 1.2434545763432379 },
  { relativeNormalSpeedMetresPerSecond: 114.89255822222209, recoverySeconds: 4.031562300708875, secondsLost: 1.2435142931969998 },
  { relativeNormalSpeedMetresPerSecond: 116.68775444444431, recoverySeconds: 4.031861307116951, secondsLost: 1.2435703438949943 },
  { relativeNormalSpeedMetresPerSecond: 118.48295066666653, recoverySeconds: 4.032148699835096, secondsLost: 1.243623005540274 },
  { relativeNormalSpeedMetresPerSecond: 120.27814688888874, recoverySeconds: 4.0324250461529445, secondsLost: 1.2436725319150486 },
  { relativeNormalSpeedMetresPerSecond: 122.07334311111096, recoverySeconds: 4.0326908795027325, secondsLost: 1.243719155590708 },
  { relativeNormalSpeedMetresPerSecond: 123.86853933333317, recoverySeconds: 4.032946701858659, secondsLost: 1.243763089837533 },
  { relativeNormalSpeedMetresPerSecond: 125.66373555555539, recoverySeconds: 4.0331929859411595, secondsLost: 1.2438045303535525 },
  { relativeNormalSpeedMetresPerSecond: 127.45893177777761, recoverySeconds: 4.033454581812651, secondsLost: 1.243862546360866 },
  { relativeNormalSpeedMetresPerSecond: 129.25412799999984, recoverySeconds: 4.0337393353784075, secondsLost: 1.2439431181903062 },
  { relativeNormalSpeedMetresPerSecond: 131.04932422222205, recoverySeconds: 4.034010991031958, secondsLost: 1.244018131367084 },
  { relativeNormalSpeedMetresPerSecond: 132.84452044444427, recoverySeconds: 4.03427230399667, secondsLost: 1.2440893891231806 },
  { relativeNormalSpeedMetresPerSecond: 134.6397166666665, recoverySeconds: 4.034523773682855, secondsLost: 1.2441571331513348 },
  { relativeNormalSpeedMetresPerSecond: 136.4349128888887, recoverySeconds: 4.034765869938693, secondsLost: 1.2442215870146027 },
  { relativeNormalSpeedMetresPerSecond: 138.23010911111092, recoverySeconds: 4.034949407165953, secondsLost: 1.2442361607149417 },
  { relativeNormalSpeedMetresPerSecond: 140.02530533333314, recoverySeconds: 4.035174372348101, secondsLost: 1.244294884557275 },
  { relativeNormalSpeedMetresPerSecond: 141.82050155555535, recoverySeconds: 4.035342179861742, secondsLost: 1.2443048757957822 },
  { relativeNormalSpeedMetresPerSecond: 143.61569777777757, recoverySeconds: 4.035551534552434, secondsLost: 1.2443585407083413 },
  { relativeNormalSpeedMetresPerSecond: 145.4108939999998, recoverySeconds: 4.035753464031282, secondsLost: 1.2444097906373592 },
  { relativeNormalSpeedMetresPerSecond: 147.206090222222, recoverySeconds: 4.035948300364851, secondsLost: 1.244458768878344 },
  { relativeNormalSpeedMetresPerSecond: 149.00128644444422, recoverySeconds: 4.036137670808538, secondsLost: 1.2445065808321725 },
  { relativeNormalSpeedMetresPerSecond: 150.79648266666644, recoverySeconds: 4.036323944074486, secondsLost: 1.2445549471736546 },
  { relativeNormalSpeedMetresPerSecond: 152.59167888888865, recoverySeconds: 4.036503831727834, secondsLost: 1.2446012959691952 },
  { relativeNormalSpeedMetresPerSecond: 154.38687511111087, recoverySeconds: 4.036677609368701, secondsLost: 1.2446457197168765 },
  { relativeNormalSpeedMetresPerSecond: 156.18207133333308, recoverySeconds: 4.03684553805062, secondsLost: 1.244688325517778 },
  { relativeNormalSpeedMetresPerSecond: 157.9772675555553, recoverySeconds: 4.037007865193859, secondsLost: 1.2447292133328034 },
  { relativeNormalSpeedMetresPerSecond: 159.77246377777752, recoverySeconds: 4.0371648072901, secondsLost: 1.2447684640544185 },
  { relativeNormalSpeedMetresPerSecond: 161.56765999999973, recoverySeconds: 4.037314999323217, secondsLost: 1.2448050743579584 },
  { relativeNormalSpeedMetresPerSecond: 163.36285622222195, recoverySeconds: 4.037460317653084, secondsLost: 1.2448402708153887 },
  { relativeNormalSpeedMetresPerSecond: 165.15805244444417, recoverySeconds: 4.037600960237722, secondsLost: 1.2448741277562418 },
  { relativeNormalSpeedMetresPerSecond: 166.95324866666638, recoverySeconds: 4.037737115239884, secondsLost: 1.2449067147875685 },
  { relativeNormalSpeedMetresPerSecond: 168.7484448888886, recoverySeconds: 4.037868961602181, secondsLost: 1.2449380971368669 },
  { relativeNormalSpeedMetresPerSecond: 170.54364111111082, recoverySeconds: 4.0379966695829985, secondsLost: 1.2449683359673989 },
  { relativeNormalSpeedMetresPerSecond: 172.33883733333303, recoverySeconds: 4.03812040125626, secondsLost: 1.244997488668313 },
  { relativeNormalSpeedMetresPerSecond: 174.13403355555525, recoverySeconds: 4.038240310977773, secondsLost: 1.2450256091217646 },
  { relativeNormalSpeedMetresPerSecond: 175.92922977777746, recoverySeconds: 4.038356545820819, secondsLost: 1.24505274794903 },
  { relativeNormalSpeedMetresPerSecond: 177.72442599999968, recoverySeconds: 4.038469245983115, secondsLost: 1.2450789527374173 },
  { relativeNormalSpeedMetresPerSecond: 178, recoverySeconds: 4.038486241810119, secondsLost: 1.2450828955243147 }
]);

export const MEASURED_CONTACT_GRIND_LOSS_PROVENANCE = Object.freeze({
  schemaVersion: 1 as const,
  method:
    "one-sided sustained lateral pressure versus identical no-contact control",
  physicsStepSeconds: 0.008333333333333333,
  referenceSpeedMetresPerSecond: 47.0400463163761,
  pressureRelativeNormalSpeedMetresPerSecond: 1.7951962222222224,
  durationStepSeconds: 0.1,
  maximumDurationSeconds: 4.8,
  contactLateralSeparationMetres: 1.5,
  baselineSingleStrikeLossSeconds: 0.005054059579047088
});

/**
 * Incremental loss after subtracting the matching initial-strike bill. The
 * one-sided protocol replenishes only the striking car's inward velocity and
 * never repositions either body, so it under-prices mutually converging
 * pressure. The measured response is nonlinear; preserving every duration
 * knot avoids inventing a tuned scalar ℓgrind.
 */
export const MEASURED_CONTACT_GRIND_LOSS:
readonly MeasuredContactGrindLossPoint[] = Object.freeze([
  { durationSeconds: 0, additionalSecondsLost: 0 },
  { durationSeconds: 0.1, additionalSecondsLost: 0.005154985848663474 },
  { durationSeconds: 0.2, additionalSecondsLost: 0.010904252518966207 },
  { durationSeconds: 0.30000000000000004, additionalSecondsLost: 0.024571038838810122 },
  { durationSeconds: 0.4, additionalSecondsLost: 0.032305818480690196 },
  { durationSeconds: 0.5, additionalSecondsLost: 0.049705492729262224 },
  { durationSeconds: 0.6000000000000001, additionalSecondsLost: 0.05927104546482004 },
  { durationSeconds: 0.7000000000000001, additionalSecondsLost: 0.07984267803022 },
  { durationSeconds: 0.8, additionalSecondsLost: 0.09071777597460767 },
  { durationSeconds: 0.9, additionalSecondsLost: 0.11321805752487607 },
  { durationSeconds: 1, additionalSecondsLost: 0.12458516169790218 },
  { durationSeconds: 1.1, additionalSecondsLost: 0.14659289411682358 },
  { durationSeconds: 1.2000000000000002, additionalSecondsLost: 0.15677340105289256 },
  { durationSeconds: 1.3, additionalSecondsLost: 0.16697086044687565 },
  { durationSeconds: 1.4000000000000001, additionalSecondsLost: 0.17689163126753132 },
  { durationSeconds: 1.5, additionalSecondsLost: 0.18644550785982889 },
  { durationSeconds: 1.6, additionalSecondsLost: 0.23052901412118337 },
  { durationSeconds: 1.7000000000000002, additionalSecondsLost: 0.2609687158314749 },
  { durationSeconds: 1.8, additionalSecondsLost: 0.28035411303640473 },
  { durationSeconds: 1.9000000000000001, additionalSecondsLost: 0.3086856382429258 },
  { durationSeconds: 2, additionalSecondsLost: 0.3459057622405964 },
  { durationSeconds: 2.1, additionalSecondsLost: 0.36995540162640356 },
  { durationSeconds: 2.2, additionalSecondsLost: 0.4044391568486166 },
  { durationSeconds: 2.3000000000000003, additionalSecondsLost: 0.44802168593231323 },
  { durationSeconds: 2.4000000000000004, additionalSecondsLost: 0.4758220124795803 },
  { durationSeconds: 2.5, additionalSecondsLost: 0.5151867961543595 },
  { durationSeconds: 2.6, additionalSecondsLost: 0.5826999513014826 },
  { durationSeconds: 2.7, additionalSecondsLost: 0.6253299647602051 },
  { durationSeconds: 2.8000000000000003, additionalSecondsLost: 0.6695834321408161 },
  { durationSeconds: 2.9000000000000004, additionalSecondsLost: 0.7614415813974402 },
  { durationSeconds: 3, additionalSecondsLost: 0.8086221333499128 },
  { durationSeconds: 3.1, additionalSecondsLost: 0.855977112257367 },
  { durationSeconds: 3.2, additionalSecondsLost: 0.9562405503301259 },
  { durationSeconds: 3.3000000000000003, additionalSecondsLost: 1.0067835882146758 },
  { durationSeconds: 3.4000000000000004, additionalSecondsLost: 1.0578315850751048 },
  { durationSeconds: 3.5, additionalSecondsLost: 1.1068827120174556 },
  { durationSeconds: 3.6, additionalSecondsLost: 1.1588996508930494 },
  { durationSeconds: 3.7, additionalSecondsLost: 1.2673831191577876 },
  { durationSeconds: 3.8000000000000003, additionalSecondsLost: 1.320996040149198 },
  { durationSeconds: 3.9000000000000004, additionalSecondsLost: 1.3750510059681649 },
  { durationSeconds: 4, additionalSecondsLost: 1.4262560601304248 },
  { durationSeconds: 4.1000000000000005, additionalSecondsLost: 1.481025991762716 },
  { durationSeconds: 4.2, additionalSecondsLost: 1.5952750597246388 },
  { durationSeconds: 4.3, additionalSecondsLost: 1.6512364178911996 },
  { durationSeconds: 4.4, additionalSecondsLost: 1.707523965825559 },
  { durationSeconds: 4.5, additionalSecondsLost: 1.760299239389943 },
  { durationSeconds: 4.6000000000000005, additionalSecondsLost: 1.8171204473152598 },
  { durationSeconds: 4.7, additionalSecondsLost: 1.9356180532717786 },
  { durationSeconds: 4.800000000000001, additionalSecondsLost: 1.9933019772635536 }
]);

type MeasuredContactField = 'recoverySeconds' | 'secondsLost';

function interpolateMeasuredContactField(
  relativeNormalSpeedMetresPerSecond: number,
  field: MeasuredContactField
): number {
  if (!Number.isFinite(relativeNormalSpeedMetresPerSecond) ||
      relativeNormalSpeedMetresPerSecond < 0)
    throw new RangeError(
      'relativeNormalSpeedMetresPerSecond must be finite and non-negative'
    );
  const lastIndex = MEASURED_CONTACT_LOSS.length - 1;
  const maximum = MEASURED_CONTACT_LOSS[lastIndex]!
    .relativeNormalSpeedMetresPerSecond;
  if (relativeNormalSpeedMetresPerSecond > maximum)
    throw new RangeError(
      `relativeNormalSpeedMetresPerSecond ` +
      `${relativeNormalSpeedMetresPerSecond} exceeds the measured physical ` +
      `curve maximum ${maximum}`
    );

  let lowerIndex = 0;
  let upperIndex = lastIndex;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (relativeNormalSpeedMetresPerSecond <=
        MEASURED_CONTACT_LOSS[middleIndex]!
          .relativeNormalSpeedMetresPerSecond)
      upperIndex = middleIndex;
    else
      lowerIndex = middleIndex;
  }
  const lower = MEASURED_CONTACT_LOSS[lowerIndex]!;
  const upper = MEASURED_CONTACT_LOSS[upperIndex]!;
  const span = upper.relativeNormalSpeedMetresPerSecond -
    lower.relativeNormalSpeedMetresPerSecond;
  const amount = span > 0
    ? (relativeNormalSpeedMetresPerSecond -
        lower.relativeNormalSpeedMetresPerSecond) / span
    : 0;
  return lower[field] + (upper[field] - lower[field]) * amount;
}

export function measuredContactLossSeconds(
  relativeNormalSpeedMetresPerSecond: number
): number {
  return interpolateMeasuredContactField(
    relativeNormalSpeedMetresPerSecond,
    'secondsLost'
  );
}

export function measuredContactRecoverySeconds(
  relativeNormalSpeedMetresPerSecond: number
): number {
  return interpolateMeasuredContactField(
    relativeNormalSpeedMetresPerSecond,
    'recoverySeconds'
  );
}

export function measuredContactGrindLossSeconds(
  durationSeconds: number
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0)
    throw new RangeError('durationSeconds must be finite and non-negative');
  const lastIndex = MEASURED_CONTACT_GRIND_LOSS.length - 1;
  const maximum = MEASURED_CONTACT_GRIND_LOSS[lastIndex]!.durationSeconds;
  const numericalTolerance =
    Number.EPSILON * Math.max(1, maximum) * 8;
  if (durationSeconds > maximum + numericalTolerance)
    throw new RangeError(
      `durationSeconds ${durationSeconds} exceeds the measured ` +
      `sustained-contact curve maximum ${maximum}`
    );
  const measuredDurationSeconds = Math.min(durationSeconds, maximum);

  let lowerIndex = 0;
  let upperIndex = lastIndex;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (measuredDurationSeconds <=
        MEASURED_CONTACT_GRIND_LOSS[middleIndex]!.durationSeconds)
      upperIndex = middleIndex;
    else
      lowerIndex = middleIndex;
  }
  const lower = MEASURED_CONTACT_GRIND_LOSS[lowerIndex]!;
  const upper = MEASURED_CONTACT_GRIND_LOSS[upperIndex]!;
  const span = upper.durationSeconds - lower.durationSeconds;
  const amount = span > 0
    ? (measuredDurationSeconds - lower.durationSeconds) / span
    : 0;
  return lower.additionalSecondsLost +
    (upper.additionalSecondsLost - lower.additionalSecondsLost) * amount;
}

/**
 * Production applies one strike at the start of every connected contact
 * episode. The sustained-pressure curve is incremental after that strike, so
 * disjoint re-contacts must each pay both components independently.
 */
export function measuredContactEpisodeLossSeconds(
  episodes: readonly Pick<
    SweptCarContactEpisode,
    'initialRelativeNormalSpeed' | 'durationSeconds'
  >[]
): number {
  let total = 0;
  for (const episode of episodes)
    total += measuredContactLossSeconds(
      episode.initialRelativeNormalSpeed
    ) + measuredContactGrindLossSeconds(episode.durationSeconds);
  return total;
}

/**
 * A covered prefix of sustained contact is a lower bound on the loss from
 * remaining in the same contact episode. This lets the evaluator prove that
 * a separation response wins without extrapolating the measured curve.
 */
export function measuredContactEpisodeLossBound(
  episodes: readonly Pick<
    SweptCarContactEpisode,
    'initialRelativeNormalSpeed' | 'durationSeconds'
  >[]
): MeasuredContactEpisodeLossBound {
  const maximumDuration = MEASURED_CONTACT_GRIND_LOSS.at(-1)!
    .durationSeconds;
  let lowerBoundSeconds = 0;
  let exact = true;
  for (const episode of episodes) {
    const coveredDuration = Math.min(
      episode.durationSeconds,
      maximumDuration
    );
    lowerBoundSeconds += measuredContactLossSeconds(
      episode.initialRelativeNormalSpeed
    ) + measuredContactGrindLossSeconds(coveredDuration);
    if (episode.durationSeconds > maximumDuration) exact = false;
  }
  return { lowerBoundSeconds, exact };
}
import type { SweptCarContactEpisode } from '../../core/collision';
