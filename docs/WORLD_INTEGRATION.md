# Virtual World Integration Contract

This document defines how an independently developed 3D world can connect to the future fly body and neural runtime without coupling engines or inventing undocumented biology.

## Ownership boundary

The world implementation owns rendering, scene assets, collision geometry, environmental fields, time of day, objects, and other agents. The fly runtime owns sensory transduction, neural dynamics, internal state, body control, experiments, and scientific telemetry.

```text
3D world ── observations ──▶ fly runtime
3D world ◀── body actions ── fly runtime
          ◀── telemetry ─── visualization/replay
```

## Required simulation clock

- Use monotonic simulation time, not wall-clock time.
- Every message carries `episode_id`, `step`, and `sim_time_seconds`.
- Physics may run at a higher frequency than rendering.
- The neural runtime may substep several times per physics step.
- Replay must be deterministic from world seed, experiment configuration, model version, and action stream.

## Observation envelope

```json
{
  "schema": "fly-world-observation/0.1",
  "episode_id": "odor-conditioning-0001",
  "step": 1200,
  "sim_time_seconds": 12.0,
  "pose": {
    "position_m": [0.0, 0.0, 0.0],
    "orientation_xyzw": [0.0, 0.0, 0.0, 1.0],
    "linear_velocity_m_s": [0.0, 0.0, 0.0],
    "angular_velocity_rad_s": [0.0, 0.0, 0.0]
  },
  "vision": {
    "left_ommatidia": [],
    "right_ommatidia": [],
    "sample_time_seconds": 12.0
  },
  "chemical": {
    "left_antenna": {"odor.food": 0.0},
    "right_antenna": {"odor.food": 0.0}
  },
  "contacts": [],
  "environment": {
    "temperature_c": 25.0,
    "wind_m_s": [0.0, 0.0, 0.0]
  }
}
```

World developers should provide physical quantities and receptor-neutral channel names. They must not send labels such as `food_direction`, `enemy_visible`, or `best_action`; those leak privileged game state into the brain.

## Action envelope

The first implementation uses an explicit hierarchical bridge:

```json
{
  "schema": "fly-world-action/0.1",
  "episode_id": "odor-conditioning-0001",
  "step": 1200,
  "mode": "walk",
  "forward_drive": 0.42,
  "turn_drive": -0.11,
  "stop_drive": 0.02,
  "proboscis_drive": 0.0
}
```

Later versions may replace this with muscle activations. The interface version must change when semantics change.

## Minimum first arena

- Bounded, collision-tested floor and walls
- One movable obstacle
- Two independently controlled odor sources
- Spatial odor sampling at both antenna positions
- Sugar and neutral contact surfaces
- Deterministic wind setting
- Resettable fly spawn pose
- Seeded episode initialization
- Headless stepping mode for training
- Recording/replay mode for presentation

## Coordinate and unit conventions

- Right-handed coordinate system
- SI units at the interface: metres, seconds, radians, kilograms
- Quaternion order must be explicitly `x, y, z, w`
- Concentrations are non-negative and state their normalization/calibration
- Anatomical MaleCNS coordinates never mix directly with world coordinates

## Presentation telemetry

The world should expose camera state, visible objects, odor-field samples, contact events, and fly trajectory. The neural runtime will separately expose spikes, population activity, internal state, plasticity events, and evidence labels. A shared timestamp aligns them in the public viewer.

## Acceptance test

The first integration passes when a deterministic prerecorded neural action stream produces the same fly trajectory twice, and a prerecorded world observation stream produces the same neural input events twice. This tests the boundary before any learning claim is made.
