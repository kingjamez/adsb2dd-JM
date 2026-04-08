export function getDopplerReadiness(delays, timestamps, options) {
  const {minSamples, minWindowSeconds} = options;
  const sampleCount = Math.min(delays.length, timestamps.length);
  const windowSeconds = sampleCount >= 2
    ? timestamps.at(-1) - timestamps[0]
    : 0;

  if (delays.length < minSamples || timestamps.length < minSamples) {
    return {
      ready: false,
      status: 'insufficient_samples',
      sampleCount,
      windowSeconds
    };
  }

  if (!Number.isFinite(windowSeconds) || windowSeconds < minWindowSeconds) {
    return {
      ready: false,
      status: 'insufficient_time_window',
      sampleCount,
      windowSeconds
    };
  }

  if (!Number.isFinite(delays[0])) {
    return {
      ready: false,
      status: 'invalid_numeric_state',
      sampleCount,
      windowSeconds
    };
  }

  for (let i = 1; i < timestamps.length; i++) {
    if (!Number.isFinite(delays[i]) || timestamps[i] <= timestamps[i - 1]) {
      return {
        ready: false,
        status: 'invalid_timestamps',
        sampleCount,
        windowSeconds
      };
    }
  }

  return {
    ready: true,
    status: 'ready',
    sampleCount,
    windowSeconds
  };
}

export function computeDopplerHz(delays, timestamps, fcMHz, options) {
  const readiness = getDopplerReadiness(delays, timestamps, options);
  if (!readiness.ready) {
    return {
      doppler: null,
      dopplerRaw: null,
      status: readiness.status,
      sampleCount: readiness.sampleCount,
      windowSeconds: readiness.windowSeconds
    };
  }

  const {smoothedDerivative, latestDerivative} = smoothedDerivativeUsingMedian(
    delays,
    timestamps,
    options.smoothWindow
  );
  const dopplerHz = -smoothedDerivative / (299792458 / (fcMHz * 1000000));
  const dopplerRawHz = -latestDerivative / (299792458 / (fcMHz * 1000000));

  if (!Number.isFinite(dopplerHz) || !Number.isFinite(dopplerRawHz)) {
    return {
      doppler: null,
      dopplerRaw: null,
      status: 'invalid_numeric_state',
      sampleCount: readiness.sampleCount,
      windowSeconds: readiness.windowSeconds
    };
  }

  return {
    doppler: dopplerHz,
    dopplerRaw: dopplerRawHz,
    status: 'ready',
    sampleCount: readiness.sampleCount,
    windowSeconds: readiness.windowSeconds
  };
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

    const deltaDelays = [];
    for (let idx = 1; idx < lastKDelays.length; idx++) {
      const deltaTime = lastKTimestamps[idx] - lastKTimestamps[idx - 1];
      deltaDelays.push((lastKDelays[idx] - lastKDelays[idx - 1]) / deltaTime);
    }

    result.push(calculateMovingMedian(deltaDelays));
  }

  return {
    smoothedDerivative: result.at(-1),
    latestDerivative: (delays.at(-1) - delays.at(-2)) / (timestamps.at(-1) - timestamps.at(-2))
  };
}

function calculateMovingMedian(arr) {
  const sortedArr = [...arr].sort((a, b) => a - b);
  const middle = Math.floor(sortedArr.length / 2);

  if (sortedArr.length % 2 === 0) {
    return (sortedArr[middle - 1] + sortedArr[middle]) / 2;
  }

  return sortedArr[middle];
}
