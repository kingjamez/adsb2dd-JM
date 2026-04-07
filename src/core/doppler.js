export function getDopplerReadiness(delays, timestamps, options) {
  const {minSamples, minWindowSeconds} = options;

  if (delays.length < minSamples || timestamps.length < minSamples) {
    return {ready: false, status: 'insufficient_samples'};
  }

  const timeWindow = timestamps.at(-1) - timestamps[0];
  if (!Number.isFinite(timeWindow) || timeWindow < minWindowSeconds) {
    return {ready: false, status: 'insufficient_time_window'};
  }

  if (!Number.isFinite(delays[0])) {
    return {ready: false, status: 'invalid_numeric_state'};
  }

  for (let i = 1; i < timestamps.length; i++) {
    if (!Number.isFinite(delays[i]) || timestamps[i] <= timestamps[i - 1]) {
      return {ready: false, status: 'invalid_timestamps'};
    }
  }

  return {ready: true, status: 'ready'};
}

export function computeDopplerHz(delays, timestamps, fcMHz, options) {
  const readiness = getDopplerReadiness(delays, timestamps, options);
  if (!readiness.ready) {
    return {doppler: undefined, status: readiness.status};
  }

  const dopplerMs = smoothedDerivativeUsingMedian(delays, timestamps, options.smoothWindow).at(-1);
  const dopplerHz = -dopplerMs / (299792458 / (fcMHz * 1000000));

  if (!Number.isFinite(dopplerHz)) {
    return {doppler: undefined, status: 'invalid_numeric_state'};
  }

  return {doppler: dopplerHz, status: 'ready'};
}

function smoothedDerivativeUsingMedian(delays, timestamps, k) {
  if (delays.length !== timestamps.length || delays.length < 2 || k < 2) {
    throw new Error('Invalid input data for computing the derivative.');
  }

  const result = [];

  for (let i = 0; i < delays.length; i++) {
    const startIdx = Math.max(0, i - k + 1);
    const endIdx = i + 1;
    const lastKDelays = delays.slice(startIdx, endIdx);
    const lastKTimestamps = timestamps.slice(startIdx, endIdx);

    const deltaDelays = lastKDelays.map((delay, idx) => {
      if (idx > 0) {
        const deltaTime = lastKTimestamps[idx] - lastKTimestamps[idx - 1];
        return (delay - lastKDelays[idx - 1]) / deltaTime;
      }

      return 0;
    });

    result.push(calculateMovingMedian(deltaDelays));
  }

  return result;
}

function calculateMovingMedian(arr) {
  const sortedArr = [...arr].sort((a, b) => a - b);
  const middle = Math.floor(sortedArr.length / 2);

  if (sortedArr.length % 2 === 0) {
    return (sortedArr[middle - 1] + sortedArr[middle]) / 2;
  }

  return sortedArr[middle];
}
