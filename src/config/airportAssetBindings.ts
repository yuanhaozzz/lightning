// Blender-authored interfaces; metres, +Y up, +Z forward. No runtime scale fixes.
export const airportAssetBindings = {
  aircraftRoot: 'Aircraft_A320neo_root',
  leftDoor: 'Aircraft_L1_anchor',
  cargoDoor: 'Aircraft_forward_cargo_anchor',
  tractorRoot: 'BaggageTractor_ROOT',
  trailerRoot: 'BaggageCart_1_ROOT',
  tractorHitch: 'BaggageTractor_RearHitch_anchor',
  trailerHitch: 'BaggageCart_1_FrontHitch_anchor',
  bogie: 'BaggageCart_1_FrontBogie',
  steer: ['BaggageTractor_Front_PosX_Steer', 'BaggageTractor_Front_NegX_Steer'],
  wheels: {
    tractorFront: ['BaggageTractor_Front_PosX_Roll', 'BaggageTractor_Front_NegX_Roll'],
    tractorRear: ['BaggageTractor_Rear_PosX_Roll', 'BaggageTractor_Rear_NegX_Roll'],
    trailerFront: ['BaggageCart_1_Front_PosX_Roll', 'BaggageCart_1_Front_NegX_Roll'],
    trailerRear: ['BaggageCart_1_Rear_PosX_Roll', 'BaggageCart_1_Rear_NegX_Roll'],
  },
  // Measurements are also saved in assets/blender/vehicle-interface.json.
  reference: {
    tractorHitchLocal: [0, 0.4, -0.62],
    trailerHitchLocal: [0, 0.4, 1.52],
    bogieLocal: [0, 0, 2.1],
    leftDoorLocal: [1.980802, 4.325, 13.5],
    cargoDoorLocal: [-1.675218, 3.06, 8.6],
    tractorRadius: 0.37,
    trailerRadius: 0.31,
  },
} as const
