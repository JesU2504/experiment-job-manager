"""Bounded, deterministic demonstration workload with cooperative cancellation."""

import math
import random


class LeaseLost(Exception):
    """The job was cancelled, reassigned, or its lease expired."""


def monte_carlo_pi(parameters: dict, checkpoint) -> dict:
    rng = random.Random(parameters["seed"])
    samples = parameters["samples"]
    inside = 0
    if not checkpoint(0):
        raise LeaseLost
    for start in range(0, samples, 10_000):
        stop = min(start + 10_000, samples)
        for _ in range(start, stop):
            x, y = rng.random(), rng.random()
            inside += x * x + y * y <= 1
        if not checkpoint(stop / samples):
            raise LeaseLost
    fraction = inside / samples
    return {
        "samples": samples,
        "seed": parameters["seed"],
        "pi_estimate": 4 * fraction,
        "absolute_error": abs(4 * fraction - math.pi),
        "estimated_standard_error": 4 * math.sqrt(fraction * (1 - fraction) / samples),
    }
