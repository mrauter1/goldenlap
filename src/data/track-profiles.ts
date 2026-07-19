import type { TrackProfile } from '../shared/types';

/** Generated compact ideal profiles and controller-validated corner-line libraries. */
export const TRACK_PROFILES = [
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.009447674
      },
      {
        "lateral": 0,
        "sFraction": 0.029796512
      },
      {
        "lateral": 1.261886526811868,
        "sFraction": 0.049418605
      },
      {
        "lateral": -2.6982224732777103,
        "sFraction": 0.078488372
      },
      {
        "lateral": 2.7518068044353274,
        "sFraction": 0.10755814
      },
      {
        "lateral": -1.2935083257686346,
        "sFraction": 0.16497093
      },
      {
        "lateral": 1.8763143123546613,
        "sFraction": 0.194040698
      },
      {
        "lateral": -2.076192174958997,
        "sFraction": 0.223110465
      },
      {
        "lateral": -2.176405825540423,
        "sFraction": 0.317587209
      },
      {
        "lateral": 5.133965175127612,
        "sFraction": 0.346656977
      },
      {
        "lateral": -1.2334240333503113,
        "sFraction": 0.371366279
      },
      {
        "lateral": 1.0245716289943085,
        "sFraction": 0.380087209
      },
      {
        "lateral": -3.076007714238949,
        "sFraction": 0.404796512
      },
      {
        "lateral": 2.6639796735672276,
        "sFraction": 0.433866279
      },
      {
        "lateral": -2.115993304536678,
        "sFraction": 0.659156977
      },
      {
        "lateral": 4.073179249064998,
        "sFraction": 0.688226744
      },
      {
        "lateral": -1.8443087135069074,
        "sFraction": 0.717296512
      },
      {
        "lateral": 1.1765360456099732,
        "sFraction": 0.74127907
      },
      {
        "lateral": -2.836190072610043,
        "sFraction": 0.770348837
      },
      {
        "lateral": 1.428041940983385,
        "sFraction": 0.799418605
      },
      {
        "lateral": -2.612606699327007,
        "sFraction": 0.82122093
      },
      {
        "lateral": 4.427421639644541,
        "sFraction": 0.850290698
      },
      {
        "lateral": -1.9740287486743187,
        "sFraction": 0.879360465
      },
      {
        "lateral": 0,
        "sFraction": 0.922238372
      },
      {
        "lateral": 0,
        "sFraction": 0.990552326
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 4,
      "controllerValidations": 53,
      "evaluations": 24,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "prado-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 27.09718298,
            "brakeI": 18,
            "cornerTimeSeconds": 6.469079724,
            "kind": "inside",
            "lapTimeLossSeconds": 0.066493609,
            "points": [
              {
                "eta": 0,
                "index": 1374
              },
              {
                "eta": 1.425,
                "index": 18
              },
              {
                "eta": 2.501209268,
                "index": 69
              },
              {
                "eta": 4.365178049,
                "index": 80
              },
              {
                "eta": 3.697402521,
                "index": 109
              },
              {
                "eta": 0,
                "index": 127
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 26.268852285,
            "brakeI": 17,
            "cornerTimeSeconds": 6.319735224,
            "kind": "inside",
            "lapTimeLossSeconds": 0.066273122,
            "points": [
              {
                "eta": 3.022255669,
                "index": 1374
              },
              {
                "eta": 3.022255669,
                "index": 69
              },
              {
                "eta": 3.260738128,
                "index": 80
              },
              {
                "eta": 3.022255669,
                "index": 127
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.838466342,
            "brakeI": 17,
            "cornerTimeSeconds": 6.631754291,
            "kind": "outside",
            "lapTimeLossSeconds": 0.229141927,
            "points": [
              {
                "eta": 0,
                "index": 1374
              },
              {
                "eta": -1.425,
                "index": 18
              },
              {
                "eta": -3.111290732,
                "index": 69
              },
              {
                "eta": -1.616071951,
                "index": 80
              },
              {
                "eta": 3.697402521,
                "index": 109
              },
              {
                "eta": 0,
                "index": 127
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.974532528,
            "brakeI": 18,
            "cornerTimeSeconds": 6.291463309,
            "kind": "outside",
            "lapTimeLossSeconds": 0.011659032,
            "points": [
              {
                "eta": -1.091661117,
                "index": 1374
              },
              {
                "eta": -1.091661117,
                "index": 69
              },
              {
                "eta": -1.091661117,
                "index": 80
              },
              {
                "eta": -1.091661117,
                "index": 127
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 22.480044868,
            "brakeI": 102,
            "cornerTimeSeconds": 7.124612318,
            "kind": "inside",
            "lapTimeLossSeconds": 0.341460212,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": -2.165464369,
                "index": 62
              },
              {
                "eta": -2.261886527,
                "index": 68
              },
              {
                "eta": -1.714277527,
                "index": 108
              },
              {
                "eta": -3.751806804,
                "index": 148
              },
              {
                "eta": 0,
                "index": 166
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.925846678,
            "brakeI": 103,
            "cornerTimeSeconds": 6.998705134,
            "kind": "inside",
            "lapTimeLossSeconds": 0.034760857,
            "points": [
              {
                "eta": -1.7166611168546742,
                "index": 42
              },
              {
                "eta": -1.7166611168546742,
                "index": 68
              },
              {
                "eta": -1.716661117,
                "index": 108
              },
              {
                "eta": -1.7166611168546742,
                "index": 166
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.126748171,
            "brakeI": 103,
            "cornerTimeSeconds": 7.202853304,
            "kind": "outside",
            "lapTimeLossSeconds": 0.426620289,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": -0.165464369,
                "index": 62
              },
              {
                "eta": 0.056863473,
                "index": 68
              },
              {
                "eta": 3.698222473,
                "index": 108
              },
              {
                "eta": -3.751806804,
                "index": 148
              },
              {
                "eta": 0,
                "index": 166
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 24.556930121,
            "brakeI": 104,
            "cornerTimeSeconds": 6.963180005,
            "kind": "outside",
            "lapTimeLossSeconds": -0.010110646,
            "points": [
              {
                "eta": 1.398193196,
                "index": 42
              },
              {
                "eta": 1.398193196,
                "index": 68
              },
              {
                "eta": 1.398193196,
                "index": 108
              },
              {
                "eta": 1.398193196,
                "index": 166
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 49.852348438,
            "brakeI": 201,
            "cornerTimeSeconds": 6.257574472,
            "kind": "inside",
            "lapTimeLossSeconds": 0.653773348,
            "points": [
              {
                "eta": 0,
                "index": 173
              },
              {
                "eta": 0.792132287,
                "index": 193
              },
              {
                "eta": 1.314185106,
                "index": 199
              },
              {
                "eta": 2.866417286,
                "index": 224
              },
              {
                "eta": 3.08324902,
                "index": 335
              },
              {
                "eta": 0,
                "index": 353
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 49.561043703,
            "brakeI": 215,
            "cornerTimeSeconds": 6.516896958,
            "kind": "inside",
            "lapTimeLossSeconds": 0.951181782,
            "points": [
              {
                "eta": 2.398685148736792,
                "index": 173
              },
              {
                "eta": 2.398685148736792,
                "index": 199
              },
              {
                "eta": 2.643857475,
                "index": 224
              },
              {
                "eta": 2.398685148736792,
                "index": 353
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 50.613823519,
            "brakeI": 208,
            "cornerTimeSeconds": 6.255192503,
            "kind": "outside",
            "lapTimeLossSeconds": 0.651396055,
            "points": [
              {
                "eta": 0,
                "index": 173
              },
              {
                "eta": -2.270367713,
                "index": 193
              },
              {
                "eta": -2.385814894,
                "index": 199
              },
              {
                "eta": -0.127332714,
                "index": 224
              },
              {
                "eta": 3.08324902,
                "index": 335
              },
              {
                "eta": 0,
                "index": 353
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 50.861756537,
            "brakeI": 202,
            "cornerTimeSeconds": 5.965726711,
            "kind": "outside",
            "lapTimeLossSeconds": 0.016196338,
            "points": [
              {
                "eta": -2.299639165664935,
                "index": 173
              },
              {
                "eta": -2.299639165664935,
                "index": 199
              },
              {
                "eta": -2.395678037,
                "index": 224
              },
              {
                "eta": -2.299639165664935,
                "index": 353
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 55.362670812,
            "brakeI": 267,
            "cornerTimeSeconds": 4.551442878,
            "kind": "inside",
            "lapTimeLossSeconds": 0.999472355,
            "points": [
              {
                "eta": 0,
                "index": 201
              },
              {
                "eta": 2.490243513,
                "index": 221
              },
              {
                "eta": 2.868508326,
                "index": 227
              },
              {
                "eta": 2.679935688,
                "index": 267
              },
              {
                "eta": 3.076192175,
                "index": 307
              },
              {
                "eta": 0,
                "index": 325
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 56.42179239,
            "brakeI": 267,
            "cornerTimeSeconds": 4.220982796,
            "kind": "inside",
            "lapTimeLossSeconds": -0.002645485,
            "points": [
              {
                "eta": 0.483040611,
                "index": 201
              },
              {
                "eta": 0.483040611,
                "index": 227
              },
              {
                "eta": 0.483040611,
                "index": 267
              },
              {
                "eta": 0.483040611,
                "index": 325
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 49.213249649,
            "brakeI": 250,
            "cornerTimeSeconds": 4.778500676,
            "kind": "outside",
            "lapTimeLossSeconds": 1.20215022,
            "points": [
              {
                "eta": 0,
                "index": 201
              },
              {
                "eta": -1.209756487,
                "index": 221
              },
              {
                "eta": -1.118991674,
                "index": 227
              },
              {
                "eta": -2.301314312,
                "index": 267
              },
              {
                "eta": 3.076192175,
                "index": 307
              },
              {
                "eta": 0,
                "index": 325
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 57.052124784,
            "brakeI": 267,
            "cornerTimeSeconds": 4.246088022,
            "kind": "outside",
            "lapTimeLossSeconds": 0.169971282,
            "points": [
              {
                "eta": -2.3216695276907067,
                "index": 201
              },
              {
                "eta": -2.3216695276907067,
                "index": 227
              },
              {
                "eta": -2.333748056,
                "index": 267
              },
              {
                "eta": -2.3216695276907067,
                "index": 325
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 17.161327466,
            "brakeI": 477,
            "cornerTimeSeconds": 7.287592119,
            "kind": "inside",
            "lapTimeLossSeconds": 0.280010089,
            "points": [
              {
                "eta": 0,
                "index": 411
              },
              {
                "eta": 3.176313995,
                "index": 431
              },
              {
                "eta": 3.282655826,
                "index": 437
              },
              {
                "eta": 0.416034825,
                "index": 477
              },
              {
                "eta": 2.233424033,
                "index": 511
              },
              {
                "eta": 0,
                "index": 529
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 17.849433871,
            "brakeI": 477,
            "cornerTimeSeconds": 7.124457398,
            "kind": "inside",
            "lapTimeLossSeconds": 0.000772379,
            "points": [
              {
                "eta": 0.022772447988415934,
                "index": 411
              },
              {
                "eta": 0.022772447988415934,
                "index": 437
              },
              {
                "eta": 0.022772448,
                "index": 477
              },
              {
                "eta": 0.022772447988415934,
                "index": 529
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.390909424,
            "brakeI": 475,
            "cornerTimeSeconds": 7.33163552,
            "kind": "outside",
            "lapTimeLossSeconds": 0.202755812,
            "points": [
              {
                "eta": 0,
                "index": 411
              },
              {
                "eta": -0.948686005,
                "index": 431
              },
              {
                "eta": -1.161094174,
                "index": 437
              },
              {
                "eta": -6.133965175,
                "index": 477
              },
              {
                "eta": 2.233424033,
                "index": 511
              },
              {
                "eta": 0,
                "index": 529
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.443186548,
            "brakeI": 477,
            "cornerTimeSeconds": 7.2209609,
            "kind": "outside",
            "lapTimeLossSeconds": 0.095114424,
            "points": [
              {
                "eta": -2.2235941744595773,
                "index": 411
              },
              {
                "eta": -2.2235941744595773,
                "index": 437
              },
              {
                "eta": -5.032889012,
                "index": 477
              },
              {
                "eta": -2.2235941744595773,
                "index": 529
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 26.550750302,
            "brakeI": 535,
            "cornerTimeSeconds": 6.680306109,
            "kind": "inside",
            "lapTimeLossSeconds": 0.158711071,
            "points": [
              {
                "eta": 0,
                "index": 497
              },
              {
                "eta": -4.089714423,
                "index": 517
              },
              {
                "eta": -4.919884129,
                "index": 523
              },
              {
                "eta": -1.66530088,
                "index": 557
              },
              {
                "eta": -3.770229674,
                "index": 597
              },
              {
                "eta": 0,
                "index": 615
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.469135771,
            "brakeI": 535,
            "cornerTimeSeconds": 6.630986116,
            "kind": "inside",
            "lapTimeLossSeconds": 0.008915691,
            "points": [
              {
                "eta": -1.4273293504267648,
                "index": 497
              },
              {
                "eta": -1.4273293504267648,
                "index": 523
              },
              {
                "eta": -1.42732935,
                "index": 557
              },
              {
                "eta": -1.4273293504267648,
                "index": 615
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.505690492,
            "brakeI": 536,
            "cornerTimeSeconds": 6.763585059,
            "kind": "outside",
            "lapTimeLossSeconds": 0.222259771,
            "points": [
              {
                "eta": 0,
                "index": 497
              },
              {
                "eta": 1.104426202,
                "index": 517
              },
              {
                "eta": 1.250428371,
                "index": 523
              },
              {
                "eta": 4.076007714,
                "index": 557
              },
              {
                "eta": -3.663979674,
                "index": 597
              },
              {
                "eta": 0,
                "index": 615
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.94829281,
            "brakeI": 536,
            "cornerTimeSeconds": 6.640103623,
            "kind": "outside",
            "lapTimeLossSeconds": -0.032260124,
            "points": [
              {
                "eta": 1.7360203264327727,
                "index": 497
              },
              {
                "eta": 1.7360203264327727,
                "index": 523
              },
              {
                "eta": 1.736020326,
                "index": 557
              },
              {
                "eta": 1.7360203264327727,
                "index": 615
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 34.216701304,
            "brakeI": 573,
            "cornerTimeSeconds": 4.542600009,
            "kind": "inside",
            "lapTimeLossSeconds": -0.281191266,
            "points": [
              {
                "eta": 0,
                "index": 519
              },
              {
                "eta": -0.41239574,
                "index": 539
              },
              {
                "eta": -0.500871444,
                "index": 545
              },
              {
                "eta": -4.548826312,
                "index": 574
              },
              {
                "eta": -3.431451776,
                "index": 590
              },
              {
                "eta": 0,
                "index": 608
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 29.27558605,
            "brakeI": 569,
            "cornerTimeSeconds": 4.826156918,
            "kind": "inside",
            "lapTimeLossSeconds": -0.006398351,
            "points": [
              {
                "eta": -1.4273293504267648,
                "index": 519
              },
              {
                "eta": -1.4273293504267648,
                "index": 545
              },
              {
                "eta": -1.42732935,
                "index": 574
              },
              {
                "eta": -1.4273293504267648,
                "index": 608
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.655607296,
            "brakeI": 565,
            "cornerTimeSeconds": 5.44456017,
            "kind": "outside",
            "lapTimeLossSeconds": 0.787858438,
            "points": [
              {
                "eta": 0,
                "index": 519
              },
              {
                "eta": 2.22510426,
                "index": 539
              },
              {
                "eta": 3.092878556,
                "index": 545
              },
              {
                "eta": 2.001173688,
                "index": 574
              },
              {
                "eta": -3.431451776,
                "index": 590
              },
              {
                "eta": 0,
                "index": 608
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.72786409,
            "brakeI": 569,
            "cornerTimeSeconds": 4.791411741,
            "kind": "outside",
            "lapTimeLossSeconds": 0.008670481,
            "points": [
              {
                "eta": 1.7360203264327727,
                "index": 519
              },
              {
                "eta": 1.7360203264327727,
                "index": 545
              },
              {
                "eta": 1.736020326,
                "index": 574
              },
              {
                "eta": 1.7360203264327727,
                "index": 608
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.411816768,
            "brakeI": 901,
            "cornerTimeSeconds": 7.447099143,
            "kind": "inside",
            "lapTimeLossSeconds": 0.653658765,
            "points": [
              {
                "eta": 0,
                "index": 852
              },
              {
                "eta": 3.058324551,
                "index": 872
              },
              {
                "eta": 3.115993305,
                "index": 907
              },
              {
                "eta": 0.623695751,
                "index": 947
              },
              {
                "eta": 2.844308714,
                "index": 987
              },
              {
                "eta": 0,
                "index": 1005
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.885492761,
            "brakeI": 872,
            "cornerTimeSeconds": 6.976622996,
            "kind": "inside",
            "lapTimeLossSeconds": 0.016010472,
            "points": [
              {
                "eta": 0.5775452190218946,
                "index": 852
              },
              {
                "eta": 0.5775452190218946,
                "index": 907
              },
              {
                "eta": 0.577545219,
                "index": 947
              },
              {
                "eta": 0.5775452190218946,
                "index": 1005
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 22.422711196,
            "brakeI": 874,
            "cornerTimeSeconds": 7.107702594,
            "kind": "outside",
            "lapTimeLossSeconds": 0.155685997,
            "points": [
              {
                "eta": 0,
                "index": 852
              },
              {
                "eta": -1.279175449,
                "index": 872
              },
              {
                "eta": -2.284006695,
                "index": 907
              },
              {
                "eta": -5.073179249,
                "index": 947
              },
              {
                "eta": 2.844308714,
                "index": 987
              },
              {
                "eta": 0,
                "index": 1005
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.826528853,
            "brakeI": 874,
            "cornerTimeSeconds": 6.922893153,
            "kind": "outside",
            "lapTimeLossSeconds": -0.054552599,
            "points": [
              {
                "eta": -2.2840066954633222,
                "index": 852
              },
              {
                "eta": -2.2840066954633222,
                "index": 907
              },
              {
                "eta": -3.425661334,
                "index": 947
              },
              {
                "eta": -2.2840066954633222,
                "index": 1005
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 29.543627504,
            "brakeI": 965,
            "cornerTimeSeconds": 5.195271463,
            "kind": "inside",
            "lapTimeLossSeconds": -0.102224479,
            "points": [
              {
                "eta": 0,
                "index": 900
              },
              {
                "eta": 1.892473794,
                "index": 920
              },
              {
                "eta": 1.267291325,
                "index": 926
              },
              {
                "eta": 3.31573757,
                "index": 965
              },
              {
                "eta": 2.065459465,
                "index": 976
              },
              {
                "eta": 0,
                "index": 994
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.17099186,
            "brakeI": 965,
            "cornerTimeSeconds": 5.290846452,
            "kind": "inside",
            "lapTimeLossSeconds": 0.010747474,
            "points": [
              {
                "eta": 0.5775452190218946,
                "index": 900
              },
              {
                "eta": 0.5775452190218946,
                "index": 926
              },
              {
                "eta": 0.577545219,
                "index": 965
              },
              {
                "eta": 0.5775452190218946,
                "index": 994
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 18.875754715,
            "brakeI": 965,
            "cornerTimeSeconds": 5.899530052,
            "kind": "outside",
            "lapTimeLossSeconds": 0.71083276,
            "points": [
              {
                "eta": 0,
                "index": 900
              },
              {
                "eta": -0.745026206,
                "index": 920
              },
              {
                "eta": -1.688958675,
                "index": 926
              },
              {
                "eta": -2.66551243,
                "index": 965
              },
              {
                "eta": 2.065459465,
                "index": 976
              },
              {
                "eta": 0,
                "index": 994
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 26.788521503,
            "brakeI": 965,
            "cornerTimeSeconds": 5.271886338,
            "kind": "outside",
            "lapTimeLossSeconds": 0.175117772,
            "points": [
              {
                "eta": -2.2840066954633222,
                "index": 900
              },
              {
                "eta": -2.2840066954633222,
                "index": 926
              },
              {
                "eta": -3.347055181,
                "index": 965
              },
              {
                "eta": -2.2840066954633222,
                "index": 994
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 25.463693529,
            "brakeI": 1026,
            "cornerTimeSeconds": 5.763760327,
            "kind": "inside",
            "lapTimeLossSeconds": 0.034468104,
            "points": [
              {
                "eta": 0,
                "index": 994
              },
              {
                "eta": -4.059634921,
                "index": 1014
              },
              {
                "eta": -3.770286046,
                "index": 1020
              },
              {
                "eta": 1.267440073,
                "index": 1060
              },
              {
                "eta": -2.428041941,
                "index": 1100
              },
              {
                "eta": 0,
                "index": 1118
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 24.926873887,
            "brakeI": 1025,
            "cornerTimeSeconds": 5.791627948,
            "kind": "inside",
            "lapTimeLossSeconds": 0.119550947,
            "points": [
              {
                "eta": -1.670596093257267,
                "index": 994
              },
              {
                "eta": -1.670596093257267,
                "index": 1020
              },
              {
                "eta": -1.670596093,
                "index": 1060
              },
              {
                "eta": -1.670596093257267,
                "index": 1118
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 26.18637555,
            "brakeI": 1026,
            "cornerTimeSeconds": 5.80900281,
            "kind": "outside",
            "lapTimeLossSeconds": 0.080442031,
            "points": [
              {
                "eta": 0,
                "index": 994
              },
              {
                "eta": 0.384115079,
                "index": 1014
              },
              {
                "eta": 0.673463954,
                "index": 1020
              },
              {
                "eta": 3.836190073,
                "index": 1060
              },
              {
                "eta": -2.428041941,
                "index": 1100
              },
              {
                "eta": 0,
                "index": 1118
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.295022291,
            "brakeI": 1026,
            "cornerTimeSeconds": 5.692385237,
            "kind": "outside",
            "lapTimeLossSeconds": -0.012722324,
            "points": [
              {
                "eta": 2.9719580590166155,
                "index": 994
              },
              {
                "eta": 2.9719580590166155,
                "index": 1020
              },
              {
                "eta": 2.971958059,
                "index": 1060
              },
              {
                "eta": 2.9719580590166155,
                "index": 1118
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 46.749002704,
            "brakeI": 1090,
            "cornerTimeSeconds": 4.585821056,
            "kind": "inside",
            "lapTimeLossSeconds": -0.094183131,
            "points": [
              {
                "eta": 0,
                "index": 1035
              },
              {
                "eta": 4.687401805,
                "index": 1055
              },
              {
                "eta": 3.835548522,
                "index": 1061
              },
              {
                "eta": 0.836810201,
                "index": 1090
              },
              {
                "eta": 1.34048911,
                "index": 1114
              },
              {
                "eta": 0,
                "index": 1132
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 44.303072516,
            "brakeI": 1090,
            "cornerTimeSeconds": 4.674995758,
            "kind": "inside",
            "lapTimeLossSeconds": 0.068836956,
            "points": [
              {
                "eta": 2.9719580590166155,
                "index": 1035
              },
              {
                "eta": 2.9719580590166155,
                "index": 1061
              },
              {
                "eta": 2.971958059,
                "index": 1090
              },
              {
                "eta": 2.9719580590166155,
                "index": 1132
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 46.834787933,
            "brakeI": 1090,
            "cornerTimeSeconds": 4.520100102,
            "kind": "outside",
            "lapTimeLossSeconds": -0.199645586,
            "points": [
              {
                "eta": 0,
                "index": 1035
              },
              {
                "eta": 0.699901805,
                "index": 1055
              },
              {
                "eta": -0.439451478,
                "index": 1061
              },
              {
                "eta": -1.411627299,
                "index": 1090
              },
              {
                "eta": 1.34048911,
                "index": 1114
              },
              {
                "eta": 0,
                "index": 1132
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 45.062738807,
            "brakeI": 1090,
            "cornerTimeSeconds": 4.769059148,
            "kind": "outside",
            "lapTimeLossSeconds": 0.136051783,
            "points": [
              {
                "eta": -1.670596093257267,
                "index": 1035
              },
              {
                "eta": -1.670596093257267,
                "index": 1061
              },
              {
                "eta": -1.842601746,
                "index": 1090
              },
              {
                "eta": -1.670596093257267,
                "index": 1132
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "prado-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.615850189,
            "brakeI": 1163,
            "cornerTimeSeconds": 6.561656837,
            "kind": "inside",
            "lapTimeLossSeconds": 0.261798355,
            "points": [
              {
                "eta": 0,
                "index": 1104
              },
              {
                "eta": 3.48482233,
                "index": 1124
              },
              {
                "eta": 3.612606699,
                "index": 1130
              },
              {
                "eta": 0.83820336,
                "index": 1170
              },
              {
                "eta": 2.974028749,
                "index": 1210
              },
              {
                "eta": 0,
                "index": 1228
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.060303815,
            "brakeI": 1163,
            "cornerTimeSeconds": 6.456068939,
            "kind": "inside",
            "lapTimeLossSeconds": 0.032507949,
            "points": [
              {
                "eta": 0.8151258828881494,
                "index": 1104
              },
              {
                "eta": 0.8151258828881494,
                "index": 1130
              },
              {
                "eta": 0.815125883,
                "index": 1170
              },
              {
                "eta": 0.8151258828881494,
                "index": 1228
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 22.683613275,
            "brakeI": 1163,
            "cornerTimeSeconds": 6.618626264,
            "kind": "outside",
            "lapTimeLossSeconds": 0.318767782,
            "points": [
              {
                "eta": 0,
                "index": 1104
              },
              {
                "eta": -1.27767767,
                "index": 1124
              },
              {
                "eta": -1.681143301,
                "index": 1130
              },
              {
                "eta": -5.42742164,
                "index": 1170
              },
              {
                "eta": 2.974028749,
                "index": 1210
              },
              {
                "eta": 0,
                "index": 1228
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.491005501,
            "brakeI": 1163,
            "cornerTimeSeconds": 6.440426276,
            "kind": "outside",
            "lapTimeLossSeconds": -0.002312013,
            "points": [
              {
                "eta": -1.7873933006729934,
                "index": 1104
              },
              {
                "eta": -1.7873933006729934,
                "index": 1130
              },
              {
                "eta": -4.155901088,
                "index": 1170
              },
              {
                "eta": -1.7873933006729934,
                "index": 1228
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 56.569542397,
      "maximumTrackingError": 0.746359864,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 67.5875
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 511,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "normal",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:af35540f",
    "trackId": "prado"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.006783493
      },
      {
        "lateral": 0,
        "sFraction": 0.023176936
      },
      {
        "lateral": -1.9458783773751929,
        "sFraction": 0.038439796
      },
      {
        "lateral": 1.9703365623392164,
        "sFraction": 0.048049746
      },
      {
        "lateral": -1.4668741190759464,
        "sFraction": 0.057659695
      },
      {
        "lateral": -1.9280178414518014,
        "sFraction": 0.239118146
      },
      {
        "lateral": 2.6591700293356553,
        "sFraction": 0.248728095
      },
      {
        "lateral": -1.598330853590742,
        "sFraction": 0.258338044
      },
      {
        "lateral": 1.9667140632541849,
        "sFraction": 0.392312041
      },
      {
        "lateral": -2.1682146299956364,
        "sFraction": 0.40192199
      },
      {
        "lateral": 1.7688923592446373,
        "sFraction": 0.411531939
      },
      {
        "lateral": -1.9056739466590806,
        "sFraction": 0.538157151
      },
      {
        "lateral": 2.1608241179445757,
        "sFraction": 0.5477671
      },
      {
        "lateral": -0.9050316591467709,
        "sFraction": 0.557377049
      },
      {
        "lateral": -1.585998240443878,
        "sFraction": 0.582249859
      },
      {
        "lateral": 2.2172461943607775,
        "sFraction": 0.591859808
      },
      {
        "lateral": -1.3729603640455752,
        "sFraction": 0.601469757
      },
      {
        "lateral": -2.072923978320323,
        "sFraction": 0.69869983
      },
      {
        "lateral": 1.371213672510348,
        "sFraction": 0.70830978
      },
      {
        "lateral": -1.7000516959186645,
        "sFraction": 0.717919729
      },
      {
        "lateral": 0,
        "sFraction": 0.93951385
      },
      {
        "lateral": 0,
        "sFraction": 0.993216507
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 1,
      "controllerValidations": 21,
      "evaluations": 16,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "costa-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.165963777,
            "brakeI": 81,
            "cornerTimeSeconds": 4.846346871,
            "kind": "inside",
            "lapTimeLossSeconds": 0.074731634,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": 2.797191639,
                "index": 62
              },
              {
                "eta": 3.264628377,
                "index": 68
              },
              {
                "eta": 2.299975938,
                "index": 85
              },
              {
                "eta": 2.466874119,
                "index": 102
              },
              {
                "eta": 0,
                "index": 119
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.593383845,
            "brakeI": 81,
            "cornerTimeSeconds": 4.878854165,
            "kind": "inside",
            "lapTimeLossSeconds": 0.261157887,
            "points": [
              {
                "eta": 3.579663437660784,
                "index": 42
              },
              {
                "eta": 3.579663437660784,
                "index": 68
              },
              {
                "eta": 3.579663438,
                "index": 85
              },
              {
                "eta": 3.579663437660784,
                "index": 119
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 18.617325709,
            "brakeI": 80,
            "cornerTimeSeconds": 5.166193137,
            "kind": "outside",
            "lapTimeLossSeconds": 0.367019853,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": -0.477808361,
                "index": 62
              },
              {
                "eta": -0.754121623,
                "index": 68
              },
              {
                "eta": -2.970336562,
                "index": 85
              },
              {
                "eta": 2.466874119,
                "index": 102
              },
              {
                "eta": 0,
                "index": 119
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.983422782,
            "brakeI": 81,
            "cornerTimeSeconds": 4.809331229,
            "kind": "outside",
            "lapTimeLossSeconds": 0.001366039,
            "points": [
              {
                "eta": -2.4541216226248075,
                "index": 42
              },
              {
                "eta": -2.4541216226248075,
                "index": 68
              },
              {
                "eta": -3.316714878,
                "index": 85
              },
              {
                "eta": -2.4541216226248075,
                "index": 119
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 17.453778142,
            "brakeI": 392,
            "cornerTimeSeconds": 6.828160381,
            "kind": "inside",
            "lapTimeLossSeconds": 0.419938686,
            "points": [
              {
                "eta": 0,
                "index": 346
              },
              {
                "eta": 2.908587119,
                "index": 366
              },
              {
                "eta": 2.928017841,
                "index": 423
              },
              {
                "eta": -0.095107529,
                "index": 440
              },
              {
                "eta": 4.162393354,
                "index": 457
              },
              {
                "eta": 0,
                "index": 474
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.703250719,
            "brakeI": 365,
            "cornerTimeSeconds": 6.504384664,
            "kind": "inside",
            "lapTimeLossSeconds": 0.048707494,
            "points": [
              {
                "eta": 2.8908299706643454,
                "index": 346
              },
              {
                "eta": 2.8908299706643454,
                "index": 423
              },
              {
                "eta": 2.890829971,
                "index": 440
              },
              {
                "eta": 2.8908299706643454,
                "index": 474
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 18.502846223,
            "brakeI": 367,
            "cornerTimeSeconds": 6.47921268,
            "kind": "outside",
            "lapTimeLossSeconds": -0.129747902,
            "points": [
              {
                "eta": 0,
                "index": 346
              },
              {
                "eta": -1.216412881,
                "index": 366
              },
              {
                "eta": -2.471982159,
                "index": 423
              },
              {
                "eta": -4.227920029,
                "index": 440
              },
              {
                "eta": 2.598330854,
                "index": 457
              },
              {
                "eta": 0,
                "index": 474
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.625126883,
            "brakeI": 368,
            "cornerTimeSeconds": 6.529102978,
            "kind": "outside",
            "lapTimeLossSeconds": 0.00009805,
            "points": [
              {
                "eta": -2.471982158548199,
                "index": 346
              },
              {
                "eta": -2.471982158548199,
                "index": 423
              },
              {
                "eta": -3.619627187,
                "index": 440
              },
              {
                "eta": -2.471982158548199,
                "index": 474
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 37.623919735,
            "brakeI": 698,
            "cornerTimeSeconds": 3.17519388,
            "kind": "inside",
            "lapTimeLossSeconds": -0.14302358,
            "points": [
              {
                "eta": 0,
                "index": 668
              },
              {
                "eta": -2.966157347,
                "index": 688
              },
              {
                "eta": -4.347964063,
                "index": 694
              },
              {
                "eta": -2.95522287,
                "index": 711
              },
              {
                "eta": -2.768892359,
                "index": 728
              },
              {
                "eta": 0,
                "index": 745
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.313449095,
            "brakeI": 707,
            "cornerTimeSeconds": 3.388910078,
            "kind": "inside",
            "lapTimeLossSeconds": 0.024711289,
            "points": [
              {
                "eta": -2.37429278,
                "index": 668
              },
              {
                "eta": -2.37429278,
                "index": 694
              },
              {
                "eta": -2.37429278,
                "index": 711
              },
              {
                "eta": -2.37429278,
                "index": 745
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.58251138,
            "brakeI": 649,
            "cornerTimeSeconds": 4.183845102,
            "kind": "outside",
            "lapTimeLossSeconds": 1.031817358,
            "points": [
              {
                "eta": 0,
                "index": 668
              },
              {
                "eta": 0.733842653,
                "index": 688
              },
              {
                "eta": 0.520785937,
                "index": 694
              },
              {
                "eta": 3.16821463,
                "index": 711
              },
              {
                "eta": -2.768892359,
                "index": 728
              },
              {
                "eta": 0,
                "index": 745
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.905050597,
            "brakeI": 706,
            "cornerTimeSeconds": 3.361934796,
            "kind": "outside",
            "lapTimeLossSeconds": -0.034692986,
            "points": [
              {
                "eta": 2.4332859367458157,
                "index": 668
              },
              {
                "eta": 2.4332859367458157,
                "index": 694
              },
              {
                "eta": 2.802903093,
                "index": 711
              },
              {
                "eta": 2.4332859367458157,
                "index": 745
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 28.238335756,
            "brakeI": 893,
            "cornerTimeSeconds": 4.937670255,
            "kind": "inside",
            "lapTimeLossSeconds": 0.170751153,
            "points": [
              {
                "eta": 0,
                "index": 874
              },
              {
                "eta": -1.422624365,
                "index": 894
              },
              {
                "eta": -2.189865376,
                "index": 935
              },
              {
                "eta": -3.699406875,
                "index": 954
              },
              {
                "eta": -3.105743296,
                "index": 967
              },
              {
                "eta": 0,
                "index": 984
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.116580747,
            "brakeI": 893,
            "cornerTimeSeconds": 4.823958382,
            "kind": "inside",
            "lapTimeLossSeconds": 0.009134371,
            "points": [
              {
                "eta": -2.498363325193551,
                "index": 874
              },
              {
                "eta": -2.498363325193551,
                "index": 935
              },
              {
                "eta": -2.498363325,
                "index": 954
              },
              {
                "eta": -2.498363325193551,
                "index": 984
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.301814717,
            "brakeI": 907,
            "cornerTimeSeconds": 6.088736296,
            "kind": "outside",
            "lapTimeLossSeconds": 1.403840969,
            "points": [
              {
                "eta": 0,
                "index": 874
              },
              {
                "eta": 2.489875635,
                "index": 894
              },
              {
                "eta": 4.166384624,
                "index": 935
              },
              {
                "eta": 2.850593125,
                "index": 954
              },
              {
                "eta": -3.105743296,
                "index": 967
              },
              {
                "eta": 0,
                "index": 984
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.531571967,
            "brakeI": 895,
            "cornerTimeSeconds": 4.734997678,
            "kind": "outside",
            "lapTimeLossSeconds": 0.033788999,
            "points": [
              {
                "eta": 3.389175882055425,
                "index": 874
              },
              {
                "eta": 3.389175882055425,
                "index": 935
              },
              {
                "eta": 3.389175882,
                "index": 954
              },
              {
                "eta": 3.389175882055425,
                "index": 984
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 26.46189827,
            "brakeI": 969,
            "cornerTimeSeconds": 4.185072967,
            "kind": "inside",
            "lapTimeLossSeconds": 0.025656417,
            "points": [
              {
                "eta": 0,
                "index": 926
              },
              {
                "eta": 2.329995835,
                "index": 946
              },
              {
                "eta": 2.905673947,
                "index": 952
              },
              {
                "eta": 3.389175882,
                "index": 969
              },
              {
                "eta": 3.605031659,
                "index": 986
              },
              {
                "eta": 0,
                "index": 1003
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.654739126,
            "brakeI": 969,
            "cornerTimeSeconds": 4.197340724,
            "kind": "inside",
            "lapTimeLossSeconds": 0.080577403,
            "points": [
              {
                "eta": 3.389175882055425,
                "index": 926
              },
              {
                "eta": 3.389175882055425,
                "index": 952
              },
              {
                "eta": 3.389175882,
                "index": 969
              },
              {
                "eta": 3.389175882055425,
                "index": 1003
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.959982265,
            "brakeI": 969,
            "cornerTimeSeconds": 4.427938188,
            "kind": "outside",
            "lapTimeLossSeconds": 0.262470268,
            "points": [
              {
                "eta": 0,
                "index": 926
              },
              {
                "eta": -3.023910415,
                "index": 946
              },
              {
                "eta": -3.644326053,
                "index": 952
              },
              {
                "eta": -3.160824118,
                "index": 969
              },
              {
                "eta": 1.905031659,
                "index": 986
              },
              {
                "eta": 0,
                "index": 1003
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.11205498,
            "brakeI": 969,
            "cornerTimeSeconds": 4.539237331,
            "kind": "outside",
            "lapTimeLossSeconds": 0.421171023,
            "points": [
              {
                "eta": -2.498363325193551,
                "index": 926
              },
              {
                "eta": -2.498363325193551,
                "index": 952
              },
              {
                "eta": -4.195608113,
                "index": 969
              },
              {
                "eta": -2.498363325193551,
                "index": 1003
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 24.378530486,
            "brakeI": 1013,
            "cornerTimeSeconds": 4.325523244,
            "kind": "inside",
            "lapTimeLossSeconds": -0.651030045,
            "points": [
              {
                "eta": 0,
                "index": 1004
              },
              {
                "eta": 2.78457033,
                "index": 1024
              },
              {
                "eta": 4.07349824,
                "index": 1030
              },
              {
                "eta": 0.346816306,
                "index": 1047
              },
              {
                "eta": 2.799522864,
                "index": 1064
              },
              {
                "eta": 0,
                "index": 1081
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.70327937,
            "brakeI": 1044,
            "cornerTimeSeconds": 4.860920098,
            "kind": "inside",
            "lapTimeLossSeconds": 0.274114181,
            "points": [
              {
                "eta": 3.332753805639223,
                "index": 1004
              },
              {
                "eta": 3.332753805639223,
                "index": 1030
              },
              {
                "eta": 3.332753806,
                "index": 1047
              },
              {
                "eta": 3.332753805639223,
                "index": 1081
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.968492842,
            "brakeI": 1014,
            "cornerTimeSeconds": 4.568134323,
            "kind": "outside",
            "lapTimeLossSeconds": -0.444529047,
            "points": [
              {
                "eta": 0,
                "index": 1004
              },
              {
                "eta": -0.27792967,
                "index": 1024
              },
              {
                "eta": 0.58599824,
                "index": 1030
              },
              {
                "eta": -3.217246194,
                "index": 1047
              },
              {
                "eta": 2.372960364,
                "index": 1064
              },
              {
                "eta": 0,
                "index": 1081
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.669995076,
            "brakeI": 1042,
            "cornerTimeSeconds": 4.751790229,
            "kind": "outside",
            "lapTimeLossSeconds": -0.182377365,
            "points": [
              {
                "eta": -2.814001759556122,
                "index": 1004
              },
              {
                "eta": -2.814001759556122,
                "index": 1030
              },
              {
                "eta": -3.901884731,
                "index": 1047
              },
              {
                "eta": -2.814001759556122,
                "index": 1081
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 32.405020609,
            "brakeI": 1227,
            "cornerTimeSeconds": 4.082488038,
            "kind": "inside",
            "lapTimeLossSeconds": 0.380870568,
            "points": [
              {
                "eta": 0,
                "index": 1210
              },
              {
                "eta": 3.072642181,
                "index": 1230
              },
              {
                "eta": 3.072923978,
                "index": 1236
              },
              {
                "eta": 1.477223827,
                "index": 1253
              },
              {
                "eta": 2.700051696,
                "index": 1270
              },
              {
                "eta": 0,
                "index": 1287
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 33.062634945,
            "brakeI": 1240,
            "cornerTimeSeconds": 4.004989093,
            "kind": "inside",
            "lapTimeLossSeconds": 0.265867125,
            "points": [
              {
                "eta": 4.178786327489653,
                "index": 1210
              },
              {
                "eta": 4.178786327489653,
                "index": 1236
              },
              {
                "eta": 4.178786327,
                "index": 1253
              },
              {
                "eta": 4.178786327489653,
                "index": 1287
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.027494472,
            "brakeI": 1199,
            "cornerTimeSeconds": 4.462145211,
            "kind": "outside",
            "lapTimeLossSeconds": 0.708108518,
            "points": [
              {
                "eta": 0,
                "index": 1210
              },
              {
                "eta": -0.521107819,
                "index": 1230
              },
              {
                "eta": -0.414576022,
                "index": 1236
              },
              {
                "eta": -2.371213673,
                "index": 1253
              },
              {
                "eta": 2.700051696,
                "index": 1270
              },
              {
                "eta": 0,
                "index": 1287
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 34.599785614,
            "brakeI": 1204,
            "cornerTimeSeconds": 4.044814232,
            "kind": "outside",
            "lapTimeLossSeconds": -0.113125239,
            "points": [
              {
                "eta": -2.3270760216796775,
                "index": 1210
              },
              {
                "eta": -2.3270760216796775,
                "index": 1236
              },
              {
                "eta": -4.819578815,
                "index": 1253
              },
              {
                "eta": -2.3270760216796775,
                "index": 1287
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "costa-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 33.16387514,
            "brakeI": 1276,
            "cornerTimeSeconds": 4.711805308,
            "kind": "inside",
            "lapTimeLossSeconds": -0.388053498,
            "points": [
              {
                "eta": 0,
                "index": 1213
              },
              {
                "eta": 3.072887802,
                "index": 1233
              },
              {
                "eta": 3.248963163,
                "index": 1239
              },
              {
                "eta": 5.828117125,
                "index": 1276
              },
              {
                "eta": 2.696499673,
                "index": 1294
              },
              {
                "eta": 0,
                "index": 1311
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.921843758,
            "brakeI": 1272,
            "cornerTimeSeconds": 5.089314422,
            "kind": "inside",
            "lapTimeLossSeconds": 0.254370295,
            "points": [
              {
                "eta": 4.178786327489653,
                "index": 1213
              },
              {
                "eta": 4.178786327489653,
                "index": 1239
              },
              {
                "eta": 4.178786327,
                "index": 1276
              },
              {
                "eta": 4.178786327489653,
                "index": 1311
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.784547626,
            "brakeI": 1270,
            "cornerTimeSeconds": 5.26358954,
            "kind": "outside",
            "lapTimeLossSeconds": 0.302065556,
            "points": [
              {
                "eta": 0,
                "index": 1213
              },
              {
                "eta": -0.733362198,
                "index": 1233
              },
              {
                "eta": -0.451036837,
                "index": 1239
              },
              {
                "eta": 0.699992125,
                "index": 1276
              },
              {
                "eta": 2.696499673,
                "index": 1294
              },
              {
                "eta": 0,
                "index": 1311
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.778677473,
            "brakeI": 1273,
            "cornerTimeSeconds": 5.075964577,
            "kind": "outside",
            "lapTimeLossSeconds": 0.00259992,
            "points": [
              {
                "eta": -2.3270760216796775,
                "index": 1213
              },
              {
                "eta": -2.3270760216796775,
                "index": 1239
              },
              {
                "eta": -2.747606696,
                "index": 1276
              },
              {
                "eta": -2.3270760216796775,
                "index": 1311
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 64.255998189,
      "maximumTrackingError": 0.741570079,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 75.966666667
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 449,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "normal",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:d061be2c",
    "trackId": "costa"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.005449591
      },
      {
        "lateral": 0,
        "sFraction": 0.018619437
      },
      {
        "lateral": 2.019769825292751,
        "sFraction": 0.114441417
      },
      {
        "lateral": -4.468723587198183,
        "sFraction": 0.130336058
      },
      {
        "lateral": 1.0816961491014812,
        "sFraction": 0.146230699
      },
      {
        "lateral": -1.8210910394974054,
        "sFraction": 0.204813806
      },
      {
        "lateral": 1.7190211091283707,
        "sFraction": 0.220708447
      },
      {
        "lateral": -1.6215033426322043,
        "sFraction": 0.236603088
      },
      {
        "lateral": -2.4411384540703147,
        "sFraction": 0.370118074
      },
      {
        "lateral": 5.106000000000001,
        "sFraction": 0.386012716
      },
      {
        "lateral": -1.9869112251978367,
        "sFraction": 0.401907357
      },
      {
        "lateral": 1.9337777594476937,
        "sFraction": 0.412352407
      },
      {
        "lateral": -1.3213965710904447,
        "sFraction": 0.428247048
      },
      {
        "lateral": 1.4471515275724232,
        "sFraction": 0.444141689
      },
      {
        "lateral": -2.564404462641105,
        "sFraction": 0.620799273
      },
      {
        "lateral": 3.711127675138414,
        "sFraction": 0.636693915
      },
      {
        "lateral": -1.9912964366562667,
        "sFraction": 0.652588556
      },
      {
        "lateral": -3.400710078356788,
        "sFraction": 0.695731153
      },
      {
        "lateral": 4.979104638848455,
        "sFraction": 0.711625795
      },
      {
        "lateral": -1.9447226883843545,
        "sFraction": 0.727520436
      },
      {
        "lateral": -2.4780474565736945,
        "sFraction": 0.802906449
      },
      {
        "lateral": 2.9981168634071946,
        "sFraction": 0.81880109
      },
      {
        "lateral": -0.9846207826212046,
        "sFraction": 0.834695731
      },
      {
        "lateral": -1.9658084081951528,
        "sFraction": 0.876475931
      },
      {
        "lateral": 1.4409438285883513,
        "sFraction": 0.892370572
      },
      {
        "lateral": -0.8442010387219488,
        "sFraction": 0.908265213
      },
      {
        "lateral": 0,
        "sFraction": 0.951407811
      },
      {
        "lateral": 0,
        "sFraction": 0.994550409
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 0,
      "controllerValidations": 40,
      "evaluations": 40,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "nordwald-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 58.557564427,
            "brakeI": 33,
            "cornerTimeSeconds": 5.308812573,
            "kind": "inside",
            "lapTimeLossSeconds": -0.100565016,
            "points": [
              {
                "eta": 0,
                "index": 11
              },
              {
                "eta": 1.425,
                "index": 31
              },
              {
                "eta": 0.997999872,
                "index": 51
              },
              {
                "eta": 2.016124523,
                "index": 71
              },
              {
                "eta": 1.009703437,
                "index": 137
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 57.829961849,
            "brakeI": 32,
            "cornerTimeSeconds": 5.570076736,
            "kind": "inside",
            "lapTimeLossSeconds": 0.578779626,
            "points": [
              {
                "eta": 3.2559564953094267,
                "index": 11
              },
              {
                "eta": 3.2559564953094267,
                "index": 51
              },
              {
                "eta": 4.307880177,
                "index": 71
              },
              {
                "eta": 3.2559564953094267,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 57.671344792,
            "brakeI": 31,
            "cornerTimeSeconds": 5.265483853,
            "kind": "outside",
            "lapTimeLossSeconds": -0.143893737,
            "points": [
              {
                "eta": 0,
                "index": 11
              },
              {
                "eta": -1.425,
                "index": 31
              },
              {
                "eta": -2.489500128,
                "index": 51
              },
              {
                "eta": -1.683875477,
                "index": 71
              },
              {
                "eta": 1.009703437,
                "index": 137
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 58.773013557,
            "brakeI": 32,
            "cornerTimeSeconds": 5.341991806,
            "kind": "outside",
            "lapTimeLossSeconds": 0.171251546,
            "points": [
              {
                "eta": -4.4,
                "index": 11
              },
              {
                "eta": -4.4,
                "index": 51
              },
              {
                "eta": -4.428514407,
                "index": 71
              },
              {
                "eta": -4.4,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 41.797093876,
            "brakeI": 114,
            "cornerTimeSeconds": 4.558367057,
            "kind": "inside",
            "lapTimeLossSeconds": -0.399518291,
            "points": [
              {
                "eta": 0,
                "index": 28
              },
              {
                "eta": 0.999298735,
                "index": 48
              },
              {
                "eta": 1.633202069,
                "index": 54
              },
              {
                "eta": 4.234452864,
                "index": 114
              },
              {
                "eta": 1.027330304,
                "index": 136
              },
              {
                "eta": 0,
                "index": 153
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 33.669214903,
            "brakeI": 81,
            "cornerTimeSeconds": 5.19566117,
            "kind": "inside",
            "lapTimeLossSeconds": 0.840011895,
            "points": [
              {
                "eta": 3.2737467386935992,
                "index": 28
              },
              {
                "eta": 3.2737467386935992,
                "index": 54
              },
              {
                "eta": 3.848574176,
                "index": 114
              },
              {
                "eta": 3.2737467386935992,
                "index": 153
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 31.40989882,
            "brakeI": 79,
            "cornerTimeSeconds": 5.094224658,
            "kind": "outside",
            "lapTimeLossSeconds": 0.156808536,
            "points": [
              {
                "eta": 0,
                "index": 28
              },
              {
                "eta": -1.106951265,
                "index": 48
              },
              {
                "eta": -1.004297931,
                "index": 54
              },
              {
                "eta": -1.462422136,
                "index": 114
              },
              {
                "eta": 0.389830304,
                "index": 136
              },
              {
                "eta": 0,
                "index": 153
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 36.894401983,
            "brakeI": 81,
            "cornerTimeSeconds": 5.042404249,
            "kind": "outside",
            "lapTimeLossSeconds": 0.605989873,
            "points": [
              {
                "eta": -4.4,
                "index": 28
              },
              {
                "eta": -4.4,
                "index": 54
              },
              {
                "eta": -4.645899984,
                "index": 114
              },
              {
                "eta": -4.4,
                "index": 153
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 43.214779041,
            "brakeI": 141,
            "cornerTimeSeconds": 6.067625106,
            "kind": "inside",
            "lapTimeLossSeconds": 0.267006849,
            "points": [
              {
                "eta": 0,
                "index": 104
              },
              {
                "eta": -1.043128886,
                "index": 124
              },
              {
                "eta": -1.718533527,
                "index": 130
              },
              {
                "eta": -2.557966253,
                "index": 145
              },
              {
                "eta": -2.896819833,
                "index": 209
              },
              {
                "eta": 0,
                "index": 226
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 41.933172249,
            "brakeI": 137,
            "cornerTimeSeconds": 5.914546107,
            "kind": "inside",
            "lapTimeLossSeconds": 0.877671426,
            "points": [
              {
                "eta": -4.7255950941223475,
                "index": 104
              },
              {
                "eta": -4.7255950941223475,
                "index": 130
              },
              {
                "eta": -5.392640489,
                "index": 145
              },
              {
                "eta": -4.7255950941223475,
                "index": 226
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 44.521632188,
            "brakeI": 139,
            "cornerTimeSeconds": 5.822868761,
            "kind": "outside",
            "lapTimeLossSeconds": 0.045351333,
            "points": [
              {
                "eta": 0,
                "index": 104
              },
              {
                "eta": 1.205308614,
                "index": 124
              },
              {
                "eta": 1.556466473,
                "index": 130
              },
              {
                "eta": -0.557966253,
                "index": 145
              },
              {
                "eta": -2.896819833,
                "index": 209
              },
              {
                "eta": 0,
                "index": 226
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 44.347197569,
            "brakeI": 145,
            "cornerTimeSeconds": 5.826837906,
            "kind": "outside",
            "lapTimeLossSeconds": 0.182185475,
            "points": [
              {
                "eta": 2.411379404292594,
                "index": 104
              },
              {
                "eta": 2.411379404292594,
                "index": 130
              },
              {
                "eta": 3.077027607,
                "index": 145
              },
              {
                "eta": 2.411379404292594,
                "index": 226
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 47.648657864,
            "brakeI": 188,
            "cornerTimeSeconds": 5.83363051,
            "kind": "inside",
            "lapTimeLossSeconds": 0.07260376,
            "points": [
              {
                "eta": 0,
                "index": 105
              },
              {
                "eta": -1.183768575,
                "index": 125
              },
              {
                "eta": -2.479415333,
                "index": 131
              },
              {
                "eta": -6.093964966,
                "index": 188
              },
              {
                "eta": -2.896819833,
                "index": 209
              },
              {
                "eta": 0,
                "index": 226
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 36.097252809,
            "brakeI": 169,
            "cornerTimeSeconds": 5.851856475,
            "kind": "inside",
            "lapTimeLossSeconds": 0.900042339,
            "points": [
              {
                "eta": -4.738304859457236,
                "index": 105
              },
              {
                "eta": -4.738304859457236,
                "index": 131
              },
              {
                "eta": -5.993691829,
                "index": 188
              },
              {
                "eta": -4.738304859457236,
                "index": 226
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 31.480033254,
            "brakeI": 166,
            "cornerTimeSeconds": 6.156517938,
            "kind": "outside",
            "lapTimeLossSeconds": 0.429085343,
            "points": [
              {
                "eta": 0,
                "index": 105
              },
              {
                "eta": 0.940450175,
                "index": 125
              },
              {
                "eta": 0.264334667,
                "index": 131
              },
              {
                "eta": -0.681464966,
                "index": 188
              },
              {
                "eta": -2.896819833,
                "index": 209
              },
              {
                "eta": 0,
                "index": 226
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.802154686,
            "brakeI": 168,
            "cornerTimeSeconds": 5.765825389,
            "kind": "outside",
            "lapTimeLossSeconds": 0.172395262,
            "points": [
              {
                "eta": 2.411379404292594,
                "index": 105
              },
              {
                "eta": 2.411379404292594,
                "index": 131
              },
              {
                "eta": 2.616516843,
                "index": 188
              },
              {
                "eta": 2.411379404292594,
                "index": 226
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 36.581994975,
            "brakeI": 201,
            "cornerTimeSeconds": 5.542827312,
            "kind": "inside",
            "lapTimeLossSeconds": 0.356173248,
            "points": [
              {
                "eta": 0,
                "index": 176
              },
              {
                "eta": -1.351542911,
                "index": 196
              },
              {
                "eta": -0.837485623,
                "index": 202
              },
              {
                "eta": -0.949000226,
                "index": 217
              },
              {
                "eta": 4.747254203,
                "index": 278
              },
              {
                "eta": 0,
                "index": 295
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 36.436219343,
            "brakeI": 205,
            "cornerTimeSeconds": 5.219957984,
            "kind": "inside",
            "lapTimeLossSeconds": -0.094411344,
            "points": [
              {
                "eta": 2.380230174707249,
                "index": 176
              },
              {
                "eta": 2.380230174707249,
                "index": 202
              },
              {
                "eta": 2.380230175,
                "index": 217
              },
              {
                "eta": 2.380230174707249,
                "index": 295
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 37.715824399,
            "brakeI": 205,
            "cornerTimeSeconds": 5.607434265,
            "kind": "outside",
            "lapTimeLossSeconds": 0.514563978,
            "points": [
              {
                "eta": 0,
                "index": 176
              },
              {
                "eta": -3.351542911,
                "index": 196
              },
              {
                "eta": -3.899985623,
                "index": 202
              },
              {
                "eta": -2.949000226,
                "index": 217
              },
              {
                "eta": 4.747254203,
                "index": 278
              },
              {
                "eta": 0,
                "index": 295
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 37.629528166,
            "brakeI": 206,
            "cornerTimeSeconds": 5.23163255,
            "kind": "outside",
            "lapTimeLossSeconds": 0.014366948,
            "points": [
              {
                "eta": -0.17986825763304637,
                "index": 176
              },
              {
                "eta": -0.17986825763304637,
                "index": 202
              },
              {
                "eta": -0.179868258,
                "index": 217
              },
              {
                "eta": -0.17986825763304637,
                "index": 295
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 40.780228648,
            "brakeI": 250,
            "cornerTimeSeconds": 5.660919456,
            "kind": "inside",
            "lapTimeLossSeconds": 0.474265391,
            "points": [
              {
                "eta": 0,
                "index": 176
              },
              {
                "eta": -1.351542911,
                "index": 196
              },
              {
                "eta": -0.518735623,
                "index": 202
              },
              {
                "eta": 2.64132202,
                "index": 258
              },
              {
                "eta": 4.747254203,
                "index": 278
              },
              {
                "eta": 0,
                "index": 295
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 55.088611705,
            "brakeI": 258,
            "cornerTimeSeconds": 5.219957984,
            "kind": "inside",
            "lapTimeLossSeconds": -0.094411344,
            "points": [
              {
                "eta": 2.380230174707249,
                "index": 176
              },
              {
                "eta": 2.380230174707249,
                "index": 202
              },
              {
                "eta": 2.380230175,
                "index": 258
              },
              {
                "eta": 2.380230174707249,
                "index": 295
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.319295487,
            "brakeI": 237,
            "cornerTimeSeconds": 6.375235826,
            "kind": "outside",
            "lapTimeLossSeconds": 1.282365539,
            "points": [
              {
                "eta": 0,
                "index": 176
              },
              {
                "eta": -3.351542911,
                "index": 196
              },
              {
                "eta": -2.837485623,
                "index": 202
              },
              {
                "eta": -2.77117798,
                "index": 258
              },
              {
                "eta": 4.747254203,
                "index": 278
              },
              {
                "eta": 0,
                "index": 295
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 55.843122606,
            "brakeI": 258,
            "cornerTimeSeconds": 5.23163255,
            "kind": "outside",
            "lapTimeLossSeconds": 0.014366949,
            "points": [
              {
                "eta": -0.17986825763304637,
                "index": 176
              },
              {
                "eta": -0.17986825763304637,
                "index": 202
              },
              {
                "eta": -0.179868258,
                "index": 258
              },
              {
                "eta": -0.17986825763304637,
                "index": 295
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 39.01696404,
            "brakeI": 270,
            "cornerTimeSeconds": 5.004893476,
            "kind": "inside",
            "lapTimeLossSeconds": 0.902852892,
            "points": [
              {
                "eta": 0,
                "index": 226
              },
              {
                "eta": -3.019324992,
                "index": 246
              },
              {
                "eta": -3.019769825,
                "index": 252
              },
              {
                "eta": -0.512526413,
                "index": 287
              },
              {
                "eta": -2.081696149,
                "index": 322
              },
              {
                "eta": 0,
                "index": 339
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 41.873915667,
            "brakeI": 267,
            "cornerTimeSeconds": 4.533187916,
            "kind": "inside",
            "lapTimeLossSeconds": 0.02624797,
            "points": [
              {
                "eta": -0.17986825763304637,
                "index": 226
              },
              {
                "eta": -0.17986825763304637,
                "index": 252
              },
              {
                "eta": -0.179868258,
                "index": 287
              },
              {
                "eta": -0.17986825763304637,
                "index": 339
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 35.756291419,
            "brakeI": 271,
            "cornerTimeSeconds": 5.069544944,
            "kind": "outside",
            "lapTimeLossSeconds": 0.967534794,
            "points": [
              {
                "eta": 0,
                "index": 226
              },
              {
                "eta": 1.849425008,
                "index": 246
              },
              {
                "eta": 2.380230175,
                "index": 252
              },
              {
                "eta": 5.468723587,
                "index": 287
              },
              {
                "eta": -2.081696149,
                "index": 322
              },
              {
                "eta": 0,
                "index": 339
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 42.697249644,
            "brakeI": 275,
            "cornerTimeSeconds": 4.503712148,
            "kind": "outside",
            "lapTimeLossSeconds": -0.215383542,
            "points": [
              {
                "eta": 2.380230174707249,
                "index": 226
              },
              {
                "eta": 2.380230174707249,
                "index": 252
              },
              {
                "eta": 5.30990067,
                "index": 287
              },
              {
                "eta": 2.380230174707249,
                "index": 339
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 55.005411321,
            "brakeI": 331,
            "cornerTimeSeconds": 4.890568699,
            "kind": "inside",
            "lapTimeLossSeconds": 0.291663283,
            "points": [
              {
                "eta": 0,
                "index": 244
              },
              {
                "eta": -0.990149962,
                "index": 264
              },
              {
                "eta": -0.66431875,
                "index": 270
              },
              {
                "eta": -2.64784132,
                "index": 331
              },
              {
                "eta": -1.853112926,
                "index": 351
              },
              {
                "eta": 0,
                "index": 368
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 53.678208349,
            "brakeI": 331,
            "cornerTimeSeconds": 4.701898368,
            "kind": "inside",
            "lapTimeLossSeconds": -0.010448166,
            "points": [
              {
                "eta": -0.17986825763304637,
                "index": 244
              },
              {
                "eta": -0.17986825763304637,
                "index": 270
              },
              {
                "eta": -0.179868258,
                "index": 331
              },
              {
                "eta": -0.17986825763304637,
                "index": 368
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 48.850519095,
            "brakeI": 331,
            "cornerTimeSeconds": 4.956388397,
            "kind": "outside",
            "lapTimeLossSeconds": 0.359417247,
            "points": [
              {
                "eta": 0,
                "index": 244
              },
              {
                "eta": 1.755162538,
                "index": 264
              },
              {
                "eta": 2.39818125,
                "index": 270
              },
              {
                "eta": -0.64784132,
                "index": 331
              },
              {
                "eta": -1.853112926,
                "index": 351
              },
              {
                "eta": 0,
                "index": 368
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 53.927248721,
            "brakeI": 331,
            "cornerTimeSeconds": 4.718940545,
            "kind": "outside",
            "lapTimeLossSeconds": 0.18948027,
            "points": [
              {
                "eta": 2.380230174707249,
                "index": 244
              },
              {
                "eta": 2.380230174707249,
                "index": 270
              },
              {
                "eta": 3.322063967,
                "index": 331
              },
              {
                "eta": 2.380230174707249,
                "index": 368
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 27.834851655,
            "brakeI": 447,
            "cornerTimeSeconds": 6.014651814,
            "kind": "inside",
            "lapTimeLossSeconds": 0.158940488,
            "points": [
              {
                "eta": 0,
                "index": 413
              },
              {
                "eta": 2.757814387,
                "index": 433
              },
              {
                "eta": 2.821091039,
                "index": 451
              },
              {
                "eta": -0.719021109,
                "index": 486
              },
              {
                "eta": 2.727753343,
                "index": 521
              },
              {
                "eta": 0,
                "index": 538
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.214368611,
            "brakeI": 432,
            "cornerTimeSeconds": 5.890514089,
            "kind": "inside",
            "lapTimeLossSeconds": 0.063396328,
            "points": [
              {
                "eta": 2.8166102237542625,
                "index": 413
              },
              {
                "eta": 2.8166102237542625,
                "index": 451
              },
              {
                "eta": 2.816610224,
                "index": 486
              },
              {
                "eta": 2.8166102237542625,
                "index": 538
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.87531477,
            "brakeI": 432,
            "cornerTimeSeconds": 5.739174461,
            "kind": "outside",
            "lapTimeLossSeconds": -0.29198258,
            "points": [
              {
                "eta": 0,
                "index": 413
              },
              {
                "eta": -1.579685613,
                "index": 433
              },
              {
                "eta": -2.366408961,
                "index": 451
              },
              {
                "eta": -6.131521109,
                "index": 486
              },
              {
                "eta": 2.621503343,
                "index": 521
              },
              {
                "eta": 0,
                "index": 538
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.849450821,
            "brakeI": 434,
            "cornerTimeSeconds": 5.832615847,
            "kind": "outside",
            "lapTimeLossSeconds": -0.054123492,
            "points": [
              {
                "eta": -2.578908960502595,
                "index": 413
              },
              {
                "eta": -2.578908960502595,
                "index": 451
              },
              {
                "eta": -3.327546462,
                "index": 486
              },
              {
                "eta": -2.578908960502595,
                "index": 538
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 38.350848942,
            "brakeI": 509,
            "cornerTimeSeconds": 4.581704383,
            "kind": "inside",
            "lapTimeLossSeconds": -0.703417108,
            "points": [
              {
                "eta": 0,
                "index": 446
              },
              {
                "eta": 2.04999598,
                "index": 466
              },
              {
                "eta": 1.998502091,
                "index": 472
              },
              {
                "eta": 6.28042193,
                "index": 509
              },
              {
                "eta": 2.834070895,
                "index": 527
              },
              {
                "eta": 0,
                "index": 544
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 26.24452633,
            "brakeI": 498,
            "cornerTimeSeconds": 5.228514891,
            "kind": "inside",
            "lapTimeLossSeconds": 0.088015557,
            "points": [
              {
                "eta": 2.8166102237542625,
                "index": 446
              },
              {
                "eta": 2.8166102237542625,
                "index": 472
              },
              {
                "eta": 2.816610224,
                "index": 509
              },
              {
                "eta": 2.8166102237542625,
                "index": 544
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.626629759,
            "brakeI": 497,
            "cornerTimeSeconds": 5.528444201,
            "kind": "outside",
            "lapTimeLossSeconds": 0.41381924,
            "points": [
              {
                "eta": 0,
                "index": 446
              },
              {
                "eta": -0.69375402,
                "index": 466
              },
              {
                "eta": -1.595247909,
                "index": 472
              },
              {
                "eta": -0.12739057,
                "index": 509
              },
              {
                "eta": 2.621570895,
                "index": 527
              },
              {
                "eta": 0,
                "index": 544
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.581918952,
            "brakeI": 498,
            "cornerTimeSeconds": 5.171943876,
            "kind": "outside",
            "lapTimeLossSeconds": -0.040262463,
            "points": [
              {
                "eta": -2.578908960502595,
                "index": 446
              },
              {
                "eta": -2.578908960502595,
                "index": 472
              },
              {
                "eta": -2.818940625,
                "index": 509
              },
              {
                "eta": -2.578908960502595,
                "index": 544
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 16.409284445,
            "brakeI": 848,
            "cornerTimeSeconds": 7.212886411,
            "kind": "inside",
            "lapTimeLossSeconds": 0.204627893,
            "points": [
              {
                "eta": 0,
                "index": 789
              },
              {
                "eta": 3.441070902,
                "index": 809
              },
              {
                "eta": 3.759888454,
                "index": 815
              },
              {
                "eta": -0.12475,
                "index": 850
              },
              {
                "eta": 2.986911225,
                "index": 885
              },
              {
                "eta": 0,
                "index": 902
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 16.501234306,
            "brakeI": 848,
            "cornerTimeSeconds": 7.117755189,
            "kind": "inside",
            "lapTimeLossSeconds": 0.014757459,
            "points": [
              {
                "eta": 0.44399999999999995,
                "index": 789
              },
              {
                "eta": 0.44399999999999995,
                "index": 815
              },
              {
                "eta": 0.444,
                "index": 850
              },
              {
                "eta": 0.44399999999999995,
                "index": 902
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 18.864594432,
            "brakeI": 848,
            "cornerTimeSeconds": 7.373841404,
            "kind": "outside",
            "lapTimeLossSeconds": 0.253968069,
            "points": [
              {
                "eta": 0,
                "index": 789
              },
              {
                "eta": -0.683929098,
                "index": 809
              },
              {
                "eta": -0.896361546,
                "index": 815
              },
              {
                "eta": -6.106,
                "index": 850
              },
              {
                "eta": 2.986911225,
                "index": 885
              },
              {
                "eta": 0,
                "index": 902
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 18.919957492,
            "brakeI": 850,
            "cornerTimeSeconds": 7.154499495,
            "kind": "outside",
            "lapTimeLossSeconds": 0.064269554,
            "points": [
              {
                "eta": -1.9588615459296856,
                "index": 789
              },
              {
                "eta": -1.9588615459296856,
                "index": 815
              },
              {
                "eta": -3.633564702,
                "index": 850
              },
              {
                "eta": -1.9588615459296856,
                "index": 902
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 25.462030583,
            "brakeI": 912,
            "cornerTimeSeconds": 5.661319596,
            "kind": "inside",
            "lapTimeLossSeconds": -0.07371153,
            "points": [
              {
                "eta": 0,
                "index": 882
              },
              {
                "eta": -2.694182328,
                "index": 902
              },
              {
                "eta": -2.933777759,
                "index": 908
              },
              {
                "eta": 0.321396571,
                "index": 943
              },
              {
                "eta": -2.447151528,
                "index": 978
              },
              {
                "eta": 0,
                "index": 995
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.106427622,
            "brakeI": 911,
            "cornerTimeSeconds": 5.695829445,
            "kind": "inside",
            "lapTimeLossSeconds": 0.053526595,
            "points": [
              {
                "eta": -2.413088774802164,
                "index": 882
              },
              {
                "eta": -2.413088774802164,
                "index": 908
              },
              {
                "eta": -3.319651223,
                "index": 943
              },
              {
                "eta": -2.413088774802164,
                "index": 995
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.634459745,
            "brakeI": 912,
            "cornerTimeSeconds": 5.64211647,
            "kind": "outside",
            "lapTimeLossSeconds": -0.143368765,
            "points": [
              {
                "eta": 0,
                "index": 882
              },
              {
                "eta": 0.687067672,
                "index": 902
              },
              {
                "eta": 1.191222241,
                "index": 908
              },
              {
                "eta": 2.321396571,
                "index": 943
              },
              {
                "eta": -2.447151528,
                "index": 978
              },
              {
                "eta": 0,
                "index": 995
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.083860895,
            "brakeI": 913,
            "cornerTimeSeconds": 5.663008811,
            "kind": "outside",
            "lapTimeLossSeconds": -0.033589424,
            "points": [
              {
                "eta": 2.4662222405523067,
                "index": 882
              },
              {
                "eta": 2.4662222405523067,
                "index": 908
              },
              {
                "eta": 3.975189119,
                "index": 943
              },
              {
                "eta": 2.4662222405523067,
                "index": 995
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c13",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 57.313118567,
            "brakeI": 1368,
            "cornerTimeSeconds": 3.740864328,
            "kind": "inside",
            "lapTimeLossSeconds": 0.194067208,
            "points": [
              {
                "eta": 0,
                "index": 1282
              },
              {
                "eta": -0.703977704,
                "index": 1302
              },
              {
                "eta": -1.095649622,
                "index": 1308
              },
              {
                "eta": -2.002574259,
                "index": 1369
              },
              {
                "eta": -3.304250436,
                "index": 1390
              },
              {
                "eta": 0,
                "index": 1407
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.293851891,
            "brakeI": 1369,
            "cornerTimeSeconds": 3.512687612,
            "kind": "inside",
            "lapTimeLossSeconds": -0.022486552,
            "points": [
              {
                "eta": -1.8355962162308819,
                "index": 1282
              },
              {
                "eta": -1.8355962162308819,
                "index": 1308
              },
              {
                "eta": -1.835596216,
                "index": 1369
              },
              {
                "eta": -1.8355962162308819,
                "index": 1407
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 33.042484397,
            "brakeI": 1333,
            "cornerTimeSeconds": 5.149457144,
            "kind": "outside",
            "lapTimeLossSeconds": 1.849144233,
            "points": [
              {
                "eta": 0,
                "index": 1282
              },
              {
                "eta": 3.421022296,
                "index": 1302
              },
              {
                "eta": 4.091850378,
                "index": 1308
              },
              {
                "eta": 2.978675741,
                "index": 1369
              },
              {
                "eta": -3.304250436,
                "index": 1390
              },
              {
                "eta": 0,
                "index": 1407
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.713822134,
            "brakeI": 1369,
            "cornerTimeSeconds": 3.516448298,
            "kind": "outside",
            "lapTimeLossSeconds": 0.144657068,
            "points": [
              {
                "eta": 0.929305043560976,
                "index": 1282
              },
              {
                "eta": 0.929305043560976,
                "index": 1308
              },
              {
                "eta": 0.929305044,
                "index": 1369
              },
              {
                "eta": 0.929305043560976,
                "index": 1407
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c14",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 46.907529214,
            "brakeI": 1402,
            "cornerTimeSeconds": 4.604325983,
            "kind": "inside",
            "lapTimeLossSeconds": 1.394173046,
            "points": [
              {
                "eta": 0,
                "index": 1341
              },
              {
                "eta": 3.564260644,
                "index": 1361
              },
              {
                "eta": 3.734716963,
                "index": 1367
              },
              {
                "eta": 1.341997325,
                "index": 1402
              },
              {
                "eta": 2.991296437,
                "index": 1437
              },
              {
                "eta": 0,
                "index": 1454
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 49.784562799,
            "brakeI": 1402,
            "cornerTimeSeconds": 3.698596711,
            "kind": "inside",
            "lapTimeLossSeconds": 0.000367449,
            "points": [
              {
                "eta": 0.929305043560976,
                "index": 1341
              },
              {
                "eta": 0.929305043560976,
                "index": 1367
              },
              {
                "eta": 0.929305044,
                "index": 1402
              },
              {
                "eta": 0.929305043560976,
                "index": 1454
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 40.481465186,
            "brakeI": 1381,
            "cornerTimeSeconds": 4.413466767,
            "kind": "outside",
            "lapTimeLossSeconds": 1.001767547,
            "points": [
              {
                "eta": 0,
                "index": 1341
              },
              {
                "eta": -0.773239356,
                "index": 1361
              },
              {
                "eta": -0.998095537,
                "index": 1367
              },
              {
                "eta": -4.136127675,
                "index": 1402
              },
              {
                "eta": 2.991296437,
                "index": 1437
              },
              {
                "eta": 0,
                "index": 1454
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 49.82090211,
            "brakeI": 1402,
            "cornerTimeSeconds": 3.820868261,
            "kind": "outside",
            "lapTimeLossSeconds": 0.374141595,
            "points": [
              {
                "eta": -1.8355962162308819,
                "index": 1341
              },
              {
                "eta": -1.8355962162308819,
                "index": 1367
              },
              {
                "eta": -3.806859432,
                "index": 1402
              },
              {
                "eta": -1.8355962162308819,
                "index": 1454
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c15",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 32.380013157,
            "brakeI": 1547,
            "cornerTimeSeconds": 5.54441006,
            "kind": "inside",
            "lapTimeLossSeconds": 0.452827445,
            "points": [
              {
                "eta": 0,
                "index": 1512
              },
              {
                "eta": 4.400710078,
                "index": 1532
              },
              {
                "eta": 4.079656566,
                "index": 1538
              },
              {
                "eta": 3.825528022,
                "index": 1550
              },
              {
                "eta": 2.783645965,
                "index": 1597
              },
              {
                "eta": 0,
                "index": 1614
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.785356119,
            "brakeI": 1550,
            "cornerTimeSeconds": 5.317972419,
            "kind": "inside",
            "lapTimeLossSeconds": 0.039886634,
            "points": [
              {
                "eta": 0.5708953611515462,
                "index": 1512
              },
              {
                "eta": 0.5708953611515462,
                "index": 1538
              },
              {
                "eta": 0.570895361,
                "index": 1550
              },
              {
                "eta": 0.5708953611515462,
                "index": 1614
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.631349565,
            "brakeI": 1550,
            "cornerTimeSeconds": 5.434882574,
            "kind": "outside",
            "lapTimeLossSeconds": 0.163209104,
            "points": [
              {
                "eta": 0,
                "index": 1512
              },
              {
                "eta": -0.999289922,
                "index": 1532
              },
              {
                "eta": -1.320343434,
                "index": 1538
              },
              {
                "eta": -2.013534478,
                "index": 1550
              },
              {
                "eta": 2.783645965,
                "index": 1597
              },
              {
                "eta": 0,
                "index": 1614
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.792133021,
            "brakeI": 1550,
            "cornerTimeSeconds": 5.733234847,
            "kind": "outside",
            "lapTimeLossSeconds": 0.451022311,
            "points": [
              {
                "eta": -0.9992899216432125,
                "index": 1512
              },
              {
                "eta": -0.9992899216432125,
                "index": 1538
              },
              {
                "eta": -4.365964282,
                "index": 1550
              },
              {
                "eta": -0.9992899216432125,
                "index": 1614
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c16",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 25.066692408,
            "brakeI": 1559,
            "cornerTimeSeconds": 5.99913791,
            "kind": "inside",
            "lapTimeLossSeconds": 0.589702747,
            "points": [
              {
                "eta": 0,
                "index": 1506
              },
              {
                "eta": 4.397487207,
                "index": 1526
              },
              {
                "eta": 4.825710078,
                "index": 1532
              },
              {
                "eta": 0.002145361,
                "index": 1567
              },
              {
                "eta": 2.944722688,
                "index": 1602
              },
              {
                "eta": 0,
                "index": 1619
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 26.136348194,
            "brakeI": 1559,
            "cornerTimeSeconds": 5.691542149,
            "kind": "inside",
            "lapTimeLossSeconds": 0.039803593,
            "points": [
              {
                "eta": 0.5708953611515462,
                "index": 1506
              },
              {
                "eta": 0.5708953611515462,
                "index": 1532
              },
              {
                "eta": 0.570895361,
                "index": 1567
              },
              {
                "eta": 0.5708953611515462,
                "index": 1619
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.658637126,
            "brakeI": 1559,
            "cornerTimeSeconds": 5.937816392,
            "kind": "outside",
            "lapTimeLossSeconds": 0.373494678,
            "points": [
              {
                "eta": 0,
                "index": 1506
              },
              {
                "eta": -1.002512793,
                "index": 1526
              },
              {
                "eta": -0.999289922,
                "index": 1532
              },
              {
                "eta": -5.979104639,
                "index": 1567
              },
              {
                "eta": 2.944722688,
                "index": 1602
              },
              {
                "eta": 0,
                "index": 1619
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.284185324,
            "brakeI": 1560,
            "cornerTimeSeconds": 5.662812336,
            "kind": "outside",
            "lapTimeLossSeconds": -0.024857814,
            "points": [
              {
                "eta": -0.9992899216432125,
                "index": 1506
              },
              {
                "eta": -0.9992899216432125,
                "index": 1532
              },
              {
                "eta": -5.336402721,
                "index": 1567
              },
              {
                "eta": -0.9992899216432125,
                "index": 1619
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c17",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 78.74091905,
            "brakeI": 1769,
            "cornerTimeSeconds": 2.624991167,
            "kind": "inside",
            "lapTimeLossSeconds": -0.060874821,
            "points": [
              {
                "eta": 0,
                "index": 1707
              },
              {
                "eta": -1.125479367,
                "index": 1727
              },
              {
                "eta": -1.107464893,
                "index": 1733
              },
              {
                "eta": -1.92317567,
                "index": 1769
              },
              {
                "eta": -2.259763262,
                "index": 1789
              },
              {
                "eta": 0,
                "index": 1806
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 78.736656185,
            "brakeI": 1769,
            "cornerTimeSeconds": 2.671326396,
            "kind": "inside",
            "lapTimeLossSeconds": 0.121190123,
            "points": [
              {
                "eta": -1.9219525434263058,
                "index": 1707
              },
              {
                "eta": -1.9219525434263058,
                "index": 1733
              },
              {
                "eta": -1.921952543,
                "index": 1769
              },
              {
                "eta": -1.9219525434263058,
                "index": 1806
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 36.507159339,
            "brakeI": 1748,
            "cornerTimeSeconds": 4.363173551,
            "kind": "outside",
            "lapTimeLossSeconds": 2.158053137,
            "points": [
              {
                "eta": 0,
                "index": 1707
              },
              {
                "eta": 3.424520633,
                "index": 1727
              },
              {
                "eta": 4.080035107,
                "index": 1733
              },
              {
                "eta": 3.47682433,
                "index": 1769
              },
              {
                "eta": -2.259763262,
                "index": 1789
              },
              {
                "eta": 0,
                "index": 1806
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 78.766219571,
            "brakeI": 1769,
            "cornerTimeSeconds": 2.633990661,
            "kind": "outside",
            "lapTimeLossSeconds": 0.296642234,
            "points": [
              {
                "eta": 1.411245249933577,
                "index": 1707
              },
              {
                "eta": 1.411245249933577,
                "index": 1733
              },
              {
                "eta": 1.41124525,
                "index": 1769
              },
              {
                "eta": 1.411245249933577,
                "index": 1806
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c18",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 60.484794095,
            "brakeI": 1803,
            "cornerTimeSeconds": 4.021259479,
            "kind": "inside",
            "lapTimeLossSeconds": 1.207499171,
            "points": [
              {
                "eta": 0,
                "index": 1742
              },
              {
                "eta": 3.477809075,
                "index": 1762
              },
              {
                "eta": 3.903047457,
                "index": 1768
              },
              {
                "eta": 1.309695637,
                "index": 1803
              },
              {
                "eta": 1.984620783,
                "index": 1838
              },
              {
                "eta": 0,
                "index": 1855
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 62.93948604,
            "brakeI": 1776,
            "cornerTimeSeconds": 3.161613289,
            "kind": "inside",
            "lapTimeLossSeconds": 0.009352861,
            "points": [
              {
                "eta": 1.411245249933577,
                "index": 1742
              },
              {
                "eta": 1.411245249933577,
                "index": 1768
              },
              {
                "eta": 1.41124525,
                "index": 1803
              },
              {
                "eta": 1.411245249933577,
                "index": 1855
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 51.573431106,
            "brakeI": 1775,
            "cornerTimeSeconds": 3.679572547,
            "kind": "outside",
            "lapTimeLossSeconds": 0.756939689,
            "points": [
              {
                "eta": 0,
                "index": 1742
              },
              {
                "eta": -0.009690925,
                "index": 1762
              },
              {
                "eta": -0.221952543,
                "index": 1768
              },
              {
                "eta": -3.423116863,
                "index": 1803
              },
              {
                "eta": 1.984620783,
                "index": 1838
              },
              {
                "eta": 0,
                "index": 1855
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 60.2394613,
            "brakeI": 1803,
            "cornerTimeSeconds": 3.415870546,
            "kind": "outside",
            "lapTimeLossSeconds": 0.386257723,
            "points": [
              {
                "eta": -1.9219525434263058,
                "index": 1742
              },
              {
                "eta": -1.9219525434263058,
                "index": 1768
              },
              {
                "eta": -5.78323932,
                "index": 1803
              },
              {
                "eta": -1.9219525434263058,
                "index": 1855
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c19",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 27.85402858,
            "brakeI": 1924,
            "cornerTimeSeconds": 6.160513365,
            "kind": "inside",
            "lapTimeLossSeconds": 0.21929485,
            "points": [
              {
                "eta": 0,
                "index": 1885
              },
              {
                "eta": 2.84045356,
                "index": 1905
              },
              {
                "eta": 2.965808408,
                "index": 1930
              },
              {
                "eta": -0.440943829,
                "index": 1965
              },
              {
                "eta": 3.164513539,
                "index": 2000
              },
              {
                "eta": 0,
                "index": 2017
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.118828284,
            "brakeI": 1904,
            "cornerTimeSeconds": 5.987284392,
            "kind": "inside",
            "lapTimeLossSeconds": 0.070180675,
            "points": [
              {
                "eta": 3.2391502229453444,
                "index": 1885
              },
              {
                "eta": 3.2391502229453444,
                "index": 1930
              },
              {
                "eta": 3.239150223,
                "index": 1965
              },
              {
                "eta": 3.2391502229453444,
                "index": 2017
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.885348548,
            "brakeI": 1906,
            "cornerTimeSeconds": 5.820989106,
            "kind": "outside",
            "lapTimeLossSeconds": -0.376931291,
            "points": [
              {
                "eta": 0,
                "index": 1885
              },
              {
                "eta": -1.49704644,
                "index": 1905
              },
              {
                "eta": -2.434191592,
                "index": 1930
              },
              {
                "eta": -5.853443829,
                "index": 1965
              },
              {
                "eta": 2.667638539,
                "index": 2000
              },
              {
                "eta": 0,
                "index": 2017
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 31.298851732,
            "brakeI": 1908,
            "cornerTimeSeconds": 5.940445413,
            "kind": "outside",
            "lapTimeLossSeconds": -0.057822392,
            "points": [
              {
                "eta": -2.4341915918048476,
                "index": 1885
              },
              {
                "eta": -2.4341915918048476,
                "index": 1930
              },
              {
                "eta": -5.245168072,
                "index": 1965
              },
              {
                "eta": -2.4341915918048476,
                "index": 2017
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "nordwald-c20",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 37.941265021,
            "brakeI": 1988,
            "cornerTimeSeconds": 5.564943977,
            "kind": "inside",
            "lapTimeLossSeconds": -0.253016798,
            "points": [
              {
                "eta": 0,
                "index": 1907
              },
              {
                "eta": 2.965484618,
                "index": 1927
              },
              {
                "eta": 2.947018557,
                "index": 1933
              },
              {
                "eta": 5.779161892,
                "index": 1990
              },
              {
                "eta": 2.156754429,
                "index": 2009
              },
              {
                "eta": 0,
                "index": 2026
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.936146244,
            "brakeI": 1979,
            "cornerTimeSeconds": 5.808765919,
            "kind": "inside",
            "lapTimeLossSeconds": 0.179216747,
            "points": [
              {
                "eta": 3.2391502229453444,
                "index": 1907
              },
              {
                "eta": 3.2391502229453444,
                "index": 1933
              },
              {
                "eta": 3.239150223,
                "index": 1990
              },
              {
                "eta": 3.2391502229453444,
                "index": 2026
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 25.714741384,
            "brakeI": 1978,
            "cornerTimeSeconds": 6.033640972,
            "kind": "outside",
            "lapTimeLossSeconds": 0.353030176,
            "points": [
              {
                "eta": 0,
                "index": 1907
              },
              {
                "eta": -0.840765382,
                "index": 1927
              },
              {
                "eta": -0.859231443,
                "index": 1933
              },
              {
                "eta": -0.486463108,
                "index": 1990
              },
              {
                "eta": 1.838004429,
                "index": 2009
              },
              {
                "eta": 0,
                "index": 2026
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.290007501,
            "brakeI": 1979,
            "cornerTimeSeconds": 5.767440681,
            "kind": "outside",
            "lapTimeLossSeconds": -0.002967916,
            "points": [
              {
                "eta": -2.4341915918048476,
                "index": 1907
              },
              {
                "eta": -2.4341915918048476,
                "index": 1933
              },
              {
                "eta": -3.652822629,
                "index": 1990
              },
              {
                "eta": -2.4341915918048476,
                "index": 2026
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 80.055501273,
      "maximumTrackingError": 0.782634316,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 92.608333334
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 569,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "acceptable",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:bfd5fc5e",
    "trackId": "nordwald"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.010033445
      },
      {
        "lateral": 0,
        "sFraction": 0.034280936
      },
      {
        "lateral": -1.98,
        "sFraction": 0.049331104
      },
      {
        "lateral": 2.42,
        "sFraction": 0.067725753
      },
      {
        "lateral": -1.54,
        "sFraction": 0.086120401
      },
      {
        "lateral": 1.98,
        "sFraction": 0.120401338
      },
      {
        "lateral": -2.42,
        "sFraction": 0.138795987
      },
      {
        "lateral": 1.54,
        "sFraction": 0.157190635
      },
      {
        "lateral": -1.98,
        "sFraction": 0.177257525
      },
      {
        "lateral": 2.42,
        "sFraction": 0.195652174
      },
      {
        "lateral": -1.54,
        "sFraction": 0.214046823
      },
      {
        "lateral": -1.98,
        "sFraction": 0.22993311
      },
      {
        "lateral": 2.42,
        "sFraction": 0.248327759
      },
      {
        "lateral": -1.54,
        "sFraction": 0.266722408
      },
      {
        "lateral": 1.98,
        "sFraction": 0.297658863
      },
      {
        "lateral": -2.42,
        "sFraction": 0.316053512
      },
      {
        "lateral": 1.54,
        "sFraction": 0.334448161
      },
      {
        "lateral": -1.98,
        "sFraction": 0.349498328
      },
      {
        "lateral": 2.42,
        "sFraction": 0.367892977
      },
      {
        "lateral": -1.54,
        "sFraction": 0.386287625
      },
      {
        "lateral": 1.98,
        "sFraction": 0.420568562
      },
      {
        "lateral": -2.42,
        "sFraction": 0.438963211
      },
      {
        "lateral": 1.54,
        "sFraction": 0.45735786
      },
      {
        "lateral": -1.98,
        "sFraction": 0.469899666
      },
      {
        "lateral": 2.42,
        "sFraction": 0.488294314
      },
      {
        "lateral": -1.54,
        "sFraction": 0.506688963
      },
      {
        "lateral": -1.98,
        "sFraction": 0.658026756
      },
      {
        "lateral": 2.42,
        "sFraction": 0.676421405
      },
      {
        "lateral": -1.54,
        "sFraction": 0.694816054
      },
      {
        "lateral": -1.98,
        "sFraction": 0.835284281
      },
      {
        "lateral": 2.42,
        "sFraction": 0.85367893
      },
      {
        "lateral": -1.54,
        "sFraction": 0.872073579
      },
      {
        "lateral": 0,
        "sFraction": 0.910535117
      },
      {
        "lateral": 0,
        "sFraction": 0.989966555
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 1,
      "controllerValidations": 32,
      "evaluations": 24,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "villa-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.670910618,
            "brakeI": 14,
            "cornerTimeSeconds": 6.24189429,
            "kind": "inside",
            "lapTimeLossSeconds": 0.031322151,
            "points": [
              {
                "eta": 0,
                "index": 1191
              },
              {
                "eta": 1.53125,
                "index": 15
              },
              {
                "eta": 2.98,
                "index": 59
              },
              {
                "eta": 0.570625,
                "index": 81
              },
              {
                "eta": 2.54,
                "index": 103
              },
              {
                "eta": 0,
                "index": 120
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.64349901,
            "brakeI": 14,
            "cornerTimeSeconds": 6.275939176,
            "kind": "inside",
            "lapTimeLossSeconds": 0.043692217,
            "points": [
              {
                "eta": 3.130000000000001,
                "index": 1191
              },
              {
                "eta": 3.130000000000001,
                "index": 59
              },
              {
                "eta": 3.13,
                "index": 81
              },
              {
                "eta": 3.130000000000001,
                "index": 120
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.731548736,
            "brakeI": 15,
            "cornerTimeSeconds": 6.207190791,
            "kind": "outside",
            "lapTimeLossSeconds": -0.03218022,
            "points": [
              {
                "eta": 0,
                "index": 1191
              },
              {
                "eta": -1.10625,
                "index": 15
              },
              {
                "eta": -2.2075,
                "index": 59
              },
              {
                "eta": -3.42,
                "index": 81
              },
              {
                "eta": 2.54,
                "index": 103
              },
              {
                "eta": 0,
                "index": 120
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.986251483,
            "brakeI": 16,
            "cornerTimeSeconds": 6.192360097,
            "kind": "outside",
            "lapTimeLossSeconds": 0.010583614,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 1191
              },
              {
                "eta": -2.4200000000000004,
                "index": 59
              },
              {
                "eta": -3.39871813,
                "index": 81
              },
              {
                "eta": -2.4200000000000004,
                "index": 120
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.47299779,
            "brakeI": 135,
            "cornerTimeSeconds": 5.376006853,
            "kind": "inside",
            "lapTimeLossSeconds": 0.037084217,
            "points": [
              {
                "eta": 0,
                "index": 116
              },
              {
                "eta": -2.789067676,
                "index": 136
              },
              {
                "eta": -2.98,
                "index": 144
              },
              {
                "eta": -2.4190625,
                "index": 166
              },
              {
                "eta": -2.54,
                "index": 188
              },
              {
                "eta": 0,
                "index": 205
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 17.978008841,
            "brakeI": 134,
            "cornerTimeSeconds": 5.703592126,
            "kind": "inside",
            "lapTimeLossSeconds": 0.620914195,
            "points": [
              {
                "eta": -2.9558547935956794,
                "index": 116
              },
              {
                "eta": -2.9558547935956794,
                "index": 144
              },
              {
                "eta": -3.13,
                "index": 166
              },
              {
                "eta": -2.9558547935956794,
                "index": 205
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.103397833,
            "brakeI": 136,
            "cornerTimeSeconds": 5.543480469,
            "kind": "outside",
            "lapTimeLossSeconds": 0.198946984,
            "points": [
              {
                "eta": 0,
                "index": 116
              },
              {
                "eta": 2.504682324,
                "index": 136
              },
              {
                "eta": 2.42,
                "index": 144
              },
              {
                "eta": 3.42,
                "index": 166
              },
              {
                "eta": -2.54,
                "index": 188
              },
              {
                "eta": 0,
                "index": 205
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.580725451,
            "brakeI": 137,
            "cornerTimeSeconds": 5.375927273,
            "kind": "outside",
            "lapTimeLossSeconds": 0.137442208,
            "points": [
              {
                "eta": 2.4200000000000004,
                "index": 116
              },
              {
                "eta": 2.4200000000000004,
                "index": 144
              },
              {
                "eta": 3.39871813,
                "index": 166
              },
              {
                "eta": 2.4200000000000004,
                "index": 205
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.612588308,
            "brakeI": 208,
            "cornerTimeSeconds": 5.409389906,
            "kind": "inside",
            "lapTimeLossSeconds": 0.027762273,
            "points": [
              {
                "eta": 0,
                "index": 188
              },
              {
                "eta": 2.855061728,
                "index": 208
              },
              {
                "eta": 2.98,
                "index": 212
              },
              {
                "eta": 2.1346875,
                "index": 234
              },
              {
                "eta": 2.54,
                "index": 256
              },
              {
                "eta": 0,
                "index": 273
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.188924119,
            "brakeI": 208,
            "cornerTimeSeconds": 5.451642643,
            "kind": "inside",
            "lapTimeLossSeconds": 0.064492628,
            "points": [
              {
                "eta": 2.8600000000000003,
                "index": 188
              },
              {
                "eta": 2.8600000000000003,
                "index": 212
              },
              {
                "eta": 3.13,
                "index": 234
              },
              {
                "eta": 2.8600000000000003,
                "index": 273
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.899245258,
            "brakeI": 208,
            "cornerTimeSeconds": 5.464482961,
            "kind": "outside",
            "lapTimeLossSeconds": 0.081233991,
            "points": [
              {
                "eta": 0,
                "index": 188
              },
              {
                "eta": -2.119938272,
                "index": 208
              },
              {
                "eta": -2.31375,
                "index": 212
              },
              {
                "eta": -3.42,
                "index": 234
              },
              {
                "eta": 2.54,
                "index": 256
              },
              {
                "eta": 0,
                "index": 273
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.617685181,
            "brakeI": 209,
            "cornerTimeSeconds": 5.376222568,
            "kind": "outside",
            "lapTimeLossSeconds": 0.042061435,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 188
              },
              {
                "eta": -2.4200000000000004,
                "index": 212
              },
              {
                "eta": -3.39871813,
                "index": 234
              },
              {
                "eta": -2.4200000000000004,
                "index": 273
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.382208398,
            "brakeI": 273,
            "cornerTimeSeconds": 5.335693974,
            "kind": "inside",
            "lapTimeLossSeconds": 0.028501639,
            "points": [
              {
                "eta": 0,
                "index": 254
              },
              {
                "eta": 2.979408085,
                "index": 274
              },
              {
                "eta": 2.98,
                "index": 275
              },
              {
                "eta": 1.42375,
                "index": 297
              },
              {
                "eta": 2.965,
                "index": 319
              },
              {
                "eta": 0,
                "index": 336
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.229349655,
            "brakeI": 272,
            "cornerTimeSeconds": 5.307197122,
            "kind": "inside",
            "lapTimeLossSeconds": 0.0556968,
            "points": [
              {
                "eta": 3.130000000000001,
                "index": 254
              },
              {
                "eta": 3.130000000000001,
                "index": 275
              },
              {
                "eta": 3.13,
                "index": 297
              },
              {
                "eta": 3.130000000000001,
                "index": 336
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.880396882,
            "brakeI": 274,
            "cornerTimeSeconds": 5.398773735,
            "kind": "outside",
            "lapTimeLossSeconds": 0.068290123,
            "points": [
              {
                "eta": 0,
                "index": 254
              },
              {
                "eta": -2.420591915,
                "index": 274
              },
              {
                "eta": -2.42,
                "index": 275
              },
              {
                "eta": -3.42,
                "index": 297
              },
              {
                "eta": 2.54,
                "index": 319
              },
              {
                "eta": 0,
                "index": 336
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.698083557,
            "brakeI": 275,
            "cornerTimeSeconds": 5.356952303,
            "kind": "outside",
            "lapTimeLossSeconds": 0.020680757,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 254
              },
              {
                "eta": -2.4200000000000004,
                "index": 275
              },
              {
                "eta": -3.39871813,
                "index": 297
              },
              {
                "eta": -2.4200000000000004,
                "index": 336
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.632973842,
            "brakeI": 347,
            "cornerTimeSeconds": 5.383078717,
            "kind": "inside",
            "lapTimeLossSeconds": 0.027943493,
            "points": [
              {
                "eta": 0,
                "index": 328
              },
              {
                "eta": -2.729613652,
                "index": 348
              },
              {
                "eta": -2.98,
                "index": 356
              },
              {
                "eta": -2.4190625,
                "index": 378
              },
              {
                "eta": -2.54,
                "index": 400
              },
              {
                "eta": 0,
                "index": 417
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 18.260397171,
            "brakeI": 346,
            "cornerTimeSeconds": 5.401863402,
            "kind": "inside",
            "lapTimeLossSeconds": 0.053169869,
            "points": [
              {
                "eta": -2.4255438703449688,
                "index": 328
              },
              {
                "eta": -2.4255438703449688,
                "index": 356
              },
              {
                "eta": -3.13,
                "index": 378
              },
              {
                "eta": -2.4255438703449688,
                "index": 417
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.295708827,
            "brakeI": 348,
            "cornerTimeSeconds": 5.546639659,
            "kind": "outside",
            "lapTimeLossSeconds": 0.189704505,
            "points": [
              {
                "eta": 0,
                "index": 328
              },
              {
                "eta": 2.457886348,
                "index": 348
              },
              {
                "eta": 2.42,
                "index": 356
              },
              {
                "eta": 3.42,
                "index": 378
              },
              {
                "eta": -2.54,
                "index": 400
              },
              {
                "eta": 0,
                "index": 417
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.689615953,
            "brakeI": 349,
            "cornerTimeSeconds": 5.394449426,
            "kind": "outside",
            "lapTimeLossSeconds": 0.174827046,
            "points": [
              {
                "eta": 2.4200000000000004,
                "index": 328
              },
              {
                "eta": 2.4200000000000004,
                "index": 356
              },
              {
                "eta": 3.39871813,
                "index": 378
              },
              {
                "eta": 2.4200000000000004,
                "index": 417
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 21.462219335,
            "brakeI": 417,
            "cornerTimeSeconds": 5.698326325,
            "kind": "inside",
            "lapTimeLossSeconds": -0.056417949,
            "points": [
              {
                "eta": 0,
                "index": 392
              },
              {
                "eta": 5.109984568,
                "index": 412
              },
              {
                "eta": 4.8925,
                "index": 418
              },
              {
                "eta": 2.56125,
                "index": 440
              },
              {
                "eta": 2.54,
                "index": 462
              },
              {
                "eta": 0,
                "index": 479
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.877084441,
            "brakeI": 417,
            "cornerTimeSeconds": 5.759822458,
            "kind": "inside",
            "lapTimeLossSeconds": 0.037710497,
            "points": [
              {
                "eta": 2.336447647018646,
                "index": 392
              },
              {
                "eta": 2.336447647018646,
                "index": 418
              },
              {
                "eta": 2.336447647,
                "index": 440
              },
              {
                "eta": 2.336447647018646,
                "index": 479
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.904142244,
            "brakeI": 418,
            "cornerTimeSeconds": 5.767974264,
            "kind": "outside",
            "lapTimeLossSeconds": -0.008499292,
            "points": [
              {
                "eta": 0,
                "index": 392
              },
              {
                "eta": 0.241234568,
                "index": 412
              },
              {
                "eta": -0.5075,
                "index": 418
              },
              {
                "eta": -3.42,
                "index": 440
              },
              {
                "eta": 2.54,
                "index": 462
              },
              {
                "eta": 0,
                "index": 479
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 24.516407168,
            "brakeI": 420,
            "cornerTimeSeconds": 5.785738243,
            "kind": "outside",
            "lapTimeLossSeconds": 0.047103734,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 392
              },
              {
                "eta": -2.4200000000000004,
                "index": 418
              },
              {
                "eta": -3.39871813,
                "index": 440
              },
              {
                "eta": -2.4200000000000004,
                "index": 479
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.399866186,
            "brakeI": 521,
            "cornerTimeSeconds": 5.361115433,
            "kind": "inside",
            "lapTimeLossSeconds": -0.002230755,
            "points": [
              {
                "eta": 0,
                "index": 477
              },
              {
                "eta": -2.892480925,
                "index": 497
              },
              {
                "eta": -2.98,
                "index": 503
              },
              {
                "eta": -3.13,
                "index": 525
              },
              {
                "eta": -2.54,
                "index": 547
              },
              {
                "eta": 0,
                "index": 564
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.624271199,
            "brakeI": 521,
            "cornerTimeSeconds": 5.394797633,
            "kind": "inside",
            "lapTimeLossSeconds": -0.116194013,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 477
              },
              {
                "eta": -2.4200000000000004,
                "index": 503
              },
              {
                "eta": -2.42,
                "index": 525
              },
              {
                "eta": -2.4200000000000004,
                "index": 564
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.569229476,
            "brakeI": 520,
            "cornerTimeSeconds": 5.620083175,
            "kind": "outside",
            "lapTimeLossSeconds": 0.256736987,
            "points": [
              {
                "eta": 0,
                "index": 477
              },
              {
                "eta": 2.401269075,
                "index": 497
              },
              {
                "eta": 2.42,
                "index": 503
              },
              {
                "eta": 3.42,
                "index": 525
              },
              {
                "eta": -2.54,
                "index": 547
              },
              {
                "eta": 0,
                "index": 564
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.474116793,
            "brakeI": 525,
            "cornerTimeSeconds": 5.392511334,
            "kind": "outside",
            "lapTimeLossSeconds": 0.211326405,
            "points": [
              {
                "eta": 2.4200000000000004,
                "index": 477
              },
              {
                "eta": 2.4200000000000004,
                "index": 503
              },
              {
                "eta": 3.39871813,
                "index": 525
              },
              {
                "eta": 2.4200000000000004,
                "index": 564
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.978002018,
            "brakeI": 579,
            "cornerTimeSeconds": 5.467343508,
            "kind": "inside",
            "lapTimeLossSeconds": 0.093976776,
            "points": [
              {
                "eta": 0,
                "index": 536
              },
              {
                "eta": 4.6251112,
                "index": 556
              },
              {
                "eta": 4.36125,
                "index": 562
              },
              {
                "eta": 3.13,
                "index": 584
              },
              {
                "eta": 2.54,
                "index": 606
              },
              {
                "eta": 0,
                "index": 623
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.655419803,
            "brakeI": 578,
            "cornerTimeSeconds": 5.449793657,
            "kind": "inside",
            "lapTimeLossSeconds": 0.066255646,
            "points": [
              {
                "eta": 2.8600000000000003,
                "index": 536
              },
              {
                "eta": 2.8600000000000003,
                "index": 562
              },
              {
                "eta": 3.13,
                "index": 584
              },
              {
                "eta": 2.8600000000000003,
                "index": 623
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.016200969,
            "brakeI": 578,
            "cornerTimeSeconds": 5.773044759,
            "kind": "outside",
            "lapTimeLossSeconds": 0.403033815,
            "points": [
              {
                "eta": 0,
                "index": 536
              },
              {
                "eta": -1.6248888,
                "index": 556
              },
              {
                "eta": -1.7825,
                "index": 562
              },
              {
                "eta": -3.42,
                "index": 584
              },
              {
                "eta": 2.54,
                "index": 606
              },
              {
                "eta": 0,
                "index": 623
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.911727777,
            "brakeI": 579,
            "cornerTimeSeconds": 5.414292077,
            "kind": "outside",
            "lapTimeLossSeconds": 0.034561782,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 536
              },
              {
                "eta": -2.4200000000000004,
                "index": 562
              },
              {
                "eta": -3.39871813,
                "index": 584
              },
              {
                "eta": -2.4200000000000004,
                "index": 623
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.622985979,
            "brakeI": 723,
            "cornerTimeSeconds": 5.959409935,
            "kind": "inside",
            "lapTimeLossSeconds": -0.034262791,
            "points": [
              {
                "eta": 0,
                "index": 662
              },
              {
                "eta": 2.695031203,
                "index": 682
              },
              {
                "eta": 3.16075355,
                "index": 715
              },
              {
                "eta": 6.31847699,
                "index": 732
              },
              {
                "eta": 2.960094756,
                "index": 754
              },
              {
                "eta": 0,
                "index": 771
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 16.6692504,
            "brakeI": 688,
            "cornerTimeSeconds": 6.140602622,
            "kind": "inside",
            "lapTimeLossSeconds": 0.674579967,
            "points": [
              {
                "eta": 6.01731946961776,
                "index": 662
              },
              {
                "eta": 6.01731946961776,
                "index": 715
              },
              {
                "eta": 6.556533513,
                "index": 732
              },
              {
                "eta": 6.01731946961776,
                "index": 771
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.204257345,
            "brakeI": 682,
            "cornerTimeSeconds": 6.05071513,
            "kind": "outside",
            "lapTimeLossSeconds": 0.056829025,
            "points": [
              {
                "eta": 0,
                "index": 662
              },
              {
                "eta": -1.217468797,
                "index": 682
              },
              {
                "eta": -1.49549645,
                "index": 715
              },
              {
                "eta": 0.90597699,
                "index": 732
              },
              {
                "eta": 2.960094756,
                "index": 754
              },
              {
                "eta": 0,
                "index": 771
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.397849482,
            "brakeI": 682,
            "cornerTimeSeconds": 5.973375056,
            "kind": "outside",
            "lapTimeLossSeconds": -0.110881826,
            "points": [
              {
                "eta": -2.4226505689799094,
                "index": 662
              },
              {
                "eta": -2.4226505689799094,
                "index": 715
              },
              {
                "eta": -2.465179241,
                "index": 732
              },
              {
                "eta": -2.4226505689799094,
                "index": 771
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 42.384297315,
            "brakeI": 773,
            "cornerTimeSeconds": 3.259015189,
            "kind": "inside",
            "lapTimeLossSeconds": -0.801584624,
            "points": [
              {
                "eta": 0,
                "index": 744
              },
              {
                "eta": -0.196144811,
                "index": 764
              },
              {
                "eta": -0.725731437,
                "index": 766
              },
              {
                "eta": -3.570501391,
                "index": 778
              },
              {
                "eta": -1.318290332,
                "index": 795
              },
              {
                "eta": 0,
                "index": 812
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.607429463,
            "brakeI": 764,
            "cornerTimeSeconds": 3.915456574,
            "kind": "inside",
            "lapTimeLossSeconds": 0.114155926,
            "points": [
              {
                "eta": -2.421807184392264,
                "index": 744
              },
              {
                "eta": -2.421807184392264,
                "index": 766
              },
              {
                "eta": -2.421807184,
                "index": 778
              },
              {
                "eta": -2.421807184392264,
                "index": 812
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.442912613,
            "brakeI": 763,
            "cornerTimeSeconds": 4.479801628,
            "kind": "outside",
            "lapTimeLossSeconds": 0.4373667,
            "points": [
              {
                "eta": 0,
                "index": 744
              },
              {
                "eta": 2.972605189,
                "index": 764
              },
              {
                "eta": 3.611768563,
                "index": 766
              },
              {
                "eta": 2.979498609,
                "index": 778
              },
              {
                "eta": -1.212040332,
                "index": 795
              },
              {
                "eta": 0,
                "index": 812
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.84563585,
            "brakeI": 765,
            "cornerTimeSeconds": 3.77567594,
            "kind": "outside",
            "lapTimeLossSeconds": -0.037309663,
            "points": [
              {
                "eta": 2.5472563349498,
                "index": 744
              },
              {
                "eta": 2.5472563349498,
                "index": 766
              },
              {
                "eta": 2.547256335,
                "index": 778
              },
              {
                "eta": 2.5472563349498,
                "index": 812
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 34.199468125,
            "brakeI": 809,
            "cornerTimeSeconds": 4.536704928,
            "kind": "inside",
            "lapTimeLossSeconds": 0.124278436,
            "points": [
              {
                "eta": 0,
                "index": 761
              },
              {
                "eta": 2.979847587,
                "index": 781
              },
              {
                "eta": 3.895625,
                "index": 787
              },
              {
                "eta": 3.13,
                "index": 809
              },
              {
                "eta": 2.54,
                "index": 831
              },
              {
                "eta": 0,
                "index": 848
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 33.780050301,
            "brakeI": 799,
            "cornerTimeSeconds": 4.428609432,
            "kind": "inside",
            "lapTimeLossSeconds": 0.109446281,
            "points": [
              {
                "eta": 2.5472563349498,
                "index": 761
              },
              {
                "eta": 2.5472563349498,
                "index": 787
              },
              {
                "eta": 2.547256335,
                "index": 809
              },
              {
                "eta": 2.5472563349498,
                "index": 848
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 26.437114069,
            "brakeI": 795,
            "cornerTimeSeconds": 4.730025043,
            "kind": "outside",
            "lapTimeLossSeconds": 0.447587211,
            "points": [
              {
                "eta": 0,
                "index": 761
              },
              {
                "eta": -2.432652413,
                "index": 781
              },
              {
                "eta": -1.5825,
                "index": 787
              },
              {
                "eta": -3.42,
                "index": 809
              },
              {
                "eta": 2.54,
                "index": 831
              },
              {
                "eta": 0,
                "index": 848
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 35.378958977,
            "brakeI": 801,
            "cornerTimeSeconds": 4.448899415,
            "kind": "outside",
            "lapTimeLossSeconds": -0.026699928,
            "points": [
              {
                "eta": -1.797947699,
                "index": 761
              },
              {
                "eta": -1.797947699,
                "index": 787
              },
              {
                "eta": -2.521728486,
                "index": 809
              },
              {
                "eta": -1.797947699,
                "index": 848
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "villa-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 16.043819316,
            "brakeI": 976,
            "cornerTimeSeconds": 6.616254815,
            "kind": "inside",
            "lapTimeLossSeconds": 0.382250606,
            "points": [
              {
                "eta": 0,
                "index": 939
              },
              {
                "eta": 2.939801435,
                "index": 959
              },
              {
                "eta": 3.72375,
                "index": 999
              },
              {
                "eta": 1.9925,
                "index": 1021
              },
              {
                "eta": 2.54,
                "index": 1043
              },
              {
                "eta": 0,
                "index": 1060
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 16.091675782,
            "brakeI": 958,
            "cornerTimeSeconds": 6.384400208,
            "kind": "inside",
            "lapTimeLossSeconds": 0.09870746,
            "points": [
              {
                "eta": 2.336447647018646,
                "index": 939
              },
              {
                "eta": 2.336447647018646,
                "index": 999
              },
              {
                "eta": 2.336447647,
                "index": 1021
              },
              {
                "eta": 2.336447647018646,
                "index": 1060
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 17.758154551,
            "brakeI": 960,
            "cornerTimeSeconds": 6.496281505,
            "kind": "outside",
            "lapTimeLossSeconds": 0.179388557,
            "points": [
              {
                "eta": 0,
                "index": 939
              },
              {
                "eta": -1.185198565,
                "index": 959
              },
              {
                "eta": -1.3575,
                "index": 999
              },
              {
                "eta": -3.42,
                "index": 1021
              },
              {
                "eta": 2.54,
                "index": 1043
              },
              {
                "eta": 0,
                "index": 1060
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.464706851,
            "brakeI": 960,
            "cornerTimeSeconds": 6.251719899,
            "kind": "outside",
            "lapTimeLossSeconds": -0.094195087,
            "points": [
              {
                "eta": -2.4200000000000004,
                "index": 939
              },
              {
                "eta": -2.4200000000000004,
                "index": 999
              },
              {
                "eta": -3.39871813,
                "index": 1021
              },
              {
                "eta": -2.4200000000000004,
                "index": 1060
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 63.042148822,
      "maximumTrackingError": 0.585935081,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 75.7
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 606,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "normal",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:265d81d6",
    "trackId": "villa"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.006622517
      },
      {
        "lateral": 0,
        "sFraction": 0.022626932
      },
      {
        "lateral": -2.1097109084436667,
        "sFraction": 0.030353201
      },
      {
        "lateral": 2.8315618069330233,
        "sFraction": 0.04415011
      },
      {
        "lateral": -1.8913161753304302,
        "sFraction": 0.05794702
      },
      {
        "lateral": 1.8925294473161922,
        "sFraction": 0.065673289
      },
      {
        "lateral": -2.8098106110934165,
        "sFraction": 0.079470199
      },
      {
        "lateral": 1.7432731859432533,
        "sFraction": 0.093267108
      },
      {
        "lateral": -1.913311211024411,
        "sFraction": 0.218543046
      },
      {
        "lateral": 5.554072728621774,
        "sFraction": 0.232339956
      },
      {
        "lateral": -1.9986812728736547,
        "sFraction": 0.246136865
      },
      {
        "lateral": 1.458678251700476,
        "sFraction": 0.274834437
      },
      {
        "lateral": -3.1488093771040435,
        "sFraction": 0.288631347
      },
      {
        "lateral": 2.0800716567505146,
        "sFraction": 0.302428256
      },
      {
        "lateral": -2.664814529470168,
        "sFraction": 0.345474614
      },
      {
        "lateral": 3.153234807495027,
        "sFraction": 0.359271523
      },
      {
        "lateral": -1.7592213260568679,
        "sFraction": 0.373068433
      },
      {
        "lateral": -2.5049992022896186,
        "sFraction": 0.487306843
      },
      {
        "lateral": 1.6087086843885476,
        "sFraction": 0.501103753
      },
      {
        "lateral": -1.8611895359260964,
        "sFraction": 0.514900662
      },
      {
        "lateral": -2.5699109245743608,
        "sFraction": 0.631898455
      },
      {
        "lateral": 5.664878671671264,
        "sFraction": 0.645695364
      },
      {
        "lateral": -1.4041373711824419,
        "sFraction": 0.659492274
      },
      {
        "lateral": -2.662564695049077,
        "sFraction": 0.697571744
      },
      {
        "lateral": 1.502637956412509,
        "sFraction": 0.711368653
      },
      {
        "lateral": -0.7796483254665509,
        "sFraction": 0.725165563
      },
      {
        "lateral": -2.5312972324341536,
        "sFraction": 0.830573951
      },
      {
        "lateral": 2.510091819660738,
        "sFraction": 0.844370861
      },
      {
        "lateral": -2.0729835731489583,
        "sFraction": 0.85816777
      },
      {
        "lateral": 0,
        "sFraction": 0.940949227
      },
      {
        "lateral": 0,
        "sFraction": 0.993377483
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 4,
      "controllerValidations": 36,
      "evaluations": 26,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "anhembi-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.65336578,
            "brakeI": 49,
            "cornerTimeSeconds": 5.717943237,
            "kind": "inside",
            "lapTimeLossSeconds": 0.006164945,
            "points": [
              {
                "eta": 0,
                "index": 25
              },
              {
                "eta": 1.30527857,
                "index": 45
              },
              {
                "eta": 3.231585908,
                "index": 55
              },
              {
                "eta": 2.271563193,
                "index": 80
              },
              {
                "eta": 2.891316175,
                "index": 105
              },
              {
                "eta": 0,
                "index": 122
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.628986461,
            "brakeI": 45,
            "cornerTimeSeconds": 5.773352571,
            "kind": "inside",
            "lapTimeLossSeconds": 0.030207308,
            "points": [
              {
                "eta": 2.748593614317077,
                "index": 25
              },
              {
                "eta": 2.748593614317077,
                "index": 55
              },
              {
                "eta": 2.748593614,
                "index": 80
              },
              {
                "eta": 2.748593614317077,
                "index": 122
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.204620205,
            "brakeI": 5,
            "cornerTimeSeconds": 5.735914525,
            "kind": "outside",
            "lapTimeLossSeconds": -0.020162489,
            "points": [
              {
                "eta": 0,
                "index": 25
              },
              {
                "eta": -1.30409643,
                "index": 45
              },
              {
                "eta": -0.352789092,
                "index": 55
              },
              {
                "eta": -3.831561807,
                "index": 80
              },
              {
                "eta": 2.891316175,
                "index": 105
              },
              {
                "eta": 0,
                "index": 122
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.781288547,
            "brakeI": 46,
            "cornerTimeSeconds": 5.732199388,
            "kind": "outside",
            "lapTimeLossSeconds": 0.101596379,
            "points": [
              {
                "eta": -2.583497172,
                "index": 25
              },
              {
                "eta": -2.583497172,
                "index": 55
              },
              {
                "eta": -3.123305273,
                "index": 80
              },
              {
                "eta": -2.583497172,
                "index": 122
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 23.696323532,
            "brakeI": 124,
            "cornerTimeSeconds": 5.86005106,
            "kind": "inside",
            "lapTimeLossSeconds": -0.282155047,
            "points": [
              {
                "eta": 0,
                "index": 93
              },
              {
                "eta": -4.791144125,
                "index": 113
              },
              {
                "eta": -4.476904447,
                "index": 119
              },
              {
                "eta": 1.809810611,
                "index": 144
              },
              {
                "eta": -3.318273186,
                "index": 169
              },
              {
                "eta": 0,
                "index": 186
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 26.149850633,
            "brakeI": 131,
            "cornerTimeSeconds": 5.991101744,
            "kind": "inside",
            "lapTimeLossSeconds": 0.107947443,
            "points": [
              {
                "eta": -2.612456251,
                "index": 93
              },
              {
                "eta": -2.612456251,
                "index": 119
              },
              {
                "eta": -2.612456251,
                "index": 144
              },
              {
                "eta": -2.612456251,
                "index": 186
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.587172156,
            "brakeI": 124,
            "cornerTimeSeconds": 5.916883337,
            "kind": "outside",
            "lapTimeLossSeconds": -0.251096065,
            "points": [
              {
                "eta": 0,
                "index": 93
              },
              {
                "eta": 0.499480875,
                "index": 113
              },
              {
                "eta": 0.691845553,
                "index": 119
              },
              {
                "eta": 3.809810611,
                "index": 144
              },
              {
                "eta": -3.318273186,
                "index": 169
              },
              {
                "eta": 0,
                "index": 186
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.798307453,
            "brakeI": 130,
            "cornerTimeSeconds": 6.002725424,
            "kind": "outside",
            "lapTimeLossSeconds": -0.040258936,
            "points": [
              {
                "eta": 3.007470552683808,
                "index": 93
              },
              {
                "eta": 3.007470552683808,
                "index": 119
              },
              {
                "eta": 3.465732507,
                "index": 144
              },
              {
                "eta": 3.007470552683808,
                "index": 186
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 24.96849856,
            "brakeI": 166,
            "cornerTimeSeconds": 6.35122495,
            "kind": "inside",
            "lapTimeLossSeconds": -0.105504009,
            "points": [
              {
                "eta": 0,
                "index": 92
              },
              {
                "eta": -4.534981636,
                "index": 112
              },
              {
                "eta": -4.586425159,
                "index": 118
              },
              {
                "eta": -2.678078038,
                "index": 166
              },
              {
                "eta": -2.741756058,
                "index": 177
              },
              {
                "eta": 0,
                "index": 194
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.209763884,
            "brakeI": 166,
            "cornerTimeSeconds": 6.46344393,
            "kind": "inside",
            "lapTimeLossSeconds": 0.125950182,
            "points": [
              {
                "eta": -2.737456250607211,
                "index": 92
              },
              {
                "eta": -2.737456250607211,
                "index": 118
              },
              {
                "eta": -2.737456251,
                "index": 166
              },
              {
                "eta": -2.737456250607211,
                "index": 194
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 22.910631079,
            "brakeI": 166,
            "cornerTimeSeconds": 6.712386238,
            "kind": "outside",
            "lapTimeLossSeconds": 0.362870834,
            "points": [
              {
                "eta": 0,
                "index": 92
              },
              {
                "eta": 0.999393364,
                "index": 112
              },
              {
                "eta": 0.094824841,
                "index": 118
              },
              {
                "eta": -0.678078038,
                "index": 166
              },
              {
                "eta": -2.741756058,
                "index": 177
              },
              {
                "eta": 0,
                "index": 194
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.406628861,
            "brakeI": 166,
            "cornerTimeSeconds": 6.457793166,
            "kind": "outside",
            "lapTimeLossSeconds": -0.053237508,
            "points": [
              {
                "eta": 2.882470553,
                "index": 92
              },
              {
                "eta": 2.882470553,
                "index": 118
              },
              {
                "eta": 2.882470553,
                "index": 166
              },
              {
                "eta": 2.882470553,
                "index": 194
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.1652941,
            "brakeI": 418,
            "cornerTimeSeconds": 5.868627499,
            "kind": "inside",
            "lapTimeLossSeconds": 0.18852844,
            "points": [
              {
                "eta": 0,
                "index": 370
              },
              {
                "eta": 2.912662469,
                "index": 390
              },
              {
                "eta": 3.035186211,
                "index": 396
              },
              {
                "eta": 0.495927271,
                "index": 421
              },
              {
                "eta": 2.998681273,
                "index": 446
              },
              {
                "eta": 0,
                "index": 463
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.842079565,
            "brakeI": 417,
            "cornerTimeSeconds": 5.738693159,
            "kind": "inside",
            "lapTimeLossSeconds": 0.008201236,
            "points": [
              {
                "eta": 0.245927271,
                "index": 370
              },
              {
                "eta": 0.245927271,
                "index": 396
              },
              {
                "eta": 0.245927271,
                "index": 421
              },
              {
                "eta": 0.245927271,
                "index": 463
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.429453175,
            "brakeI": 418,
            "cornerTimeSeconds": 6.104344979,
            "kind": "outside",
            "lapTimeLossSeconds": 0.358304054,
            "points": [
              {
                "eta": 0,
                "index": 370
              },
              {
                "eta": -0.306087531,
                "index": 390
              },
              {
                "eta": -0.427313789,
                "index": 396
              },
              {
                "eta": -6.554072729,
                "index": 421
              },
              {
                "eta": 2.998681273,
                "index": 446
              },
              {
                "eta": 0,
                "index": 463
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.538477175,
            "brakeI": 418,
            "cornerTimeSeconds": 5.728843994,
            "kind": "outside",
            "lapTimeLossSeconds": 0.021902317,
            "points": [
              {
                "eta": -2.9013187271263456,
                "index": 370
              },
              {
                "eta": -2.9013187271263456,
                "index": 396
              },
              {
                "eta": -2.901318727,
                "index": 421
              },
              {
                "eta": -2.9013187271263456,
                "index": 463
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 39.614070793,
            "brakeI": 523,
            "cornerTimeSeconds": 3.985773934,
            "kind": "inside",
            "lapTimeLossSeconds": 0.171352652,
            "points": [
              {
                "eta": 0,
                "index": 472
              },
              {
                "eta": -3.876834894,
                "index": 492
              },
              {
                "eta": -5.271178252,
                "index": 498
              },
              {
                "eta": -2.901190623,
                "index": 523
              },
              {
                "eta": -3.080071657,
                "index": 548
              },
              {
                "eta": 0,
                "index": 565
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 42.509733875,
            "brakeI": 523,
            "cornerTimeSeconds": 4.031232754,
            "kind": "inside",
            "lapTimeLossSeconds": 0.043020321,
            "points": [
              {
                "eta": -2.901190622895957,
                "index": 472
              },
              {
                "eta": -2.901190622895957,
                "index": 498
              },
              {
                "eta": -2.901190623,
                "index": 523
              },
              {
                "eta": -2.901190622895957,
                "index": 565
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 29.686814456,
            "brakeI": 502,
            "cornerTimeSeconds": 4.48166117,
            "kind": "outside",
            "lapTimeLossSeconds": 0.664143983,
            "points": [
              {
                "eta": 0,
                "index": 472
              },
              {
                "eta": 1.048165106,
                "index": 492
              },
              {
                "eta": 0.644446748,
                "index": 498
              },
              {
                "eta": 4.148809377,
                "index": 523
              },
              {
                "eta": -3.080071657,
                "index": 548
              },
              {
                "eta": 0,
                "index": 565
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 45.21311832,
            "brakeI": 523,
            "cornerTimeSeconds": 3.990270325,
            "kind": "outside",
            "lapTimeLossSeconds": -0.00964924,
            "points": [
              {
                "eta": 2.8199283432494857,
                "index": 472
              },
              {
                "eta": 2.8199283432494857,
                "index": 498
              },
              {
                "eta": 2.819928343,
                "index": 523
              },
              {
                "eta": 2.8199283432494857,
                "index": 565
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 17.653965795,
            "brakeI": 597,
            "cornerTimeSeconds": 6.07583063,
            "kind": "inside",
            "lapTimeLossSeconds": 0.127608235,
            "points": [
              {
                "eta": 0,
                "index": 577
              },
              {
                "eta": 2.383961817,
                "index": 597
              },
              {
                "eta": 3.664814529,
                "index": 626
              },
              {
                "eta": 2.738952693,
                "index": 651
              },
              {
                "eta": 2.759221326,
                "index": 676
              },
              {
                "eta": 0,
                "index": 693
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 17.567292173,
            "brakeI": 595,
            "cornerTimeSeconds": 6.055792754,
            "kind": "inside",
            "lapTimeLossSeconds": 0.111368395,
            "points": [
              {
                "eta": 2.8967651925049736,
                "index": 577
              },
              {
                "eta": 2.8967651925049736,
                "index": 626
              },
              {
                "eta": 2.896765193,
                "index": 651
              },
              {
                "eta": 2.8967651925049736,
                "index": 693
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.227998311,
            "brakeI": 598,
            "cornerTimeSeconds": 6.243558911,
            "kind": "outside",
            "lapTimeLossSeconds": 0.283298624,
            "points": [
              {
                "eta": 0,
                "index": 577
              },
              {
                "eta": -1.931663183,
                "index": 597
              },
              {
                "eta": -2.235185471,
                "index": 626
              },
              {
                "eta": -4.153234807,
                "index": 651
              },
              {
                "eta": 2.759221326,
                "index": 676
              },
              {
                "eta": 0,
                "index": 693
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.413224158,
            "brakeI": 598,
            "cornerTimeSeconds": 5.998452746,
            "kind": "outside",
            "lapTimeLossSeconds": -0.008612842,
            "points": [
              {
                "eta": -2.2351854705298324,
                "index": 577
              },
              {
                "eta": -2.2351854705298324,
                "index": 626
              },
              {
                "eta": -4.358398767,
                "index": 651
              },
              {
                "eta": -2.2351854705298324,
                "index": 693
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 53.333042097,
            "brakeI": 856,
            "cornerTimeSeconds": 2.897674467,
            "kind": "inside",
            "lapTimeLossSeconds": -0.02044985,
            "points": [
              {
                "eta": 0,
                "index": 833
              },
              {
                "eta": -1.438053601,
                "index": 853
              },
              {
                "eta": -1.670400694,
                "index": 862
              },
              {
                "eta": -2.819235567,
                "index": 896
              },
              {
                "eta": -2.03123135,
                "index": 907
              },
              {
                "eta": 0,
                "index": 924
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 44.820504915,
            "brakeI": 851,
            "cornerTimeSeconds": 3.068679614,
            "kind": "inside",
            "lapTimeLossSeconds": 0.334898608,
            "points": [
              {
                "eta": -2.3950007977103818,
                "index": 833
              },
              {
                "eta": -2.3950007977103818,
                "index": 862
              },
              {
                "eta": -2.395000798,
                "index": 896
              },
              {
                "eta": -2.3950007977103818,
                "index": 924
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 26.073969749,
            "brakeI": 863,
            "cornerTimeSeconds": 4.424811095,
            "kind": "outside",
            "lapTimeLossSeconds": 1.955018873,
            "points": [
              {
                "eta": 0,
                "index": 833
              },
              {
                "eta": 3.486946399,
                "index": 853
              },
              {
                "eta": 3.498349306,
                "index": 862
              },
              {
                "eta": 0.719045683,
                "index": 896
              },
              {
                "eta": -2.03123135,
                "index": 907
              },
              {
                "eta": 0,
                "index": 924
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 47.804509705,
            "brakeI": 858,
            "cornerTimeSeconds": 2.972948478,
            "kind": "outside",
            "lapTimeLossSeconds": -0.031440294,
            "points": [
              {
                "eta": 3.3099069166536896,
                "index": 833
              },
              {
                "eta": 3.3099069166536896,
                "index": 862
              },
              {
                "eta": 3.309906917,
                "index": 896
              },
              {
                "eta": 3.3099069166536896,
                "index": 924
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 57.483403363,
            "brakeI": 908,
            "cornerTimeSeconds": 3.527583341,
            "kind": "inside",
            "lapTimeLossSeconds": 0.770409109,
            "points": [
              {
                "eta": 0,
                "index": 857
              },
              {
                "eta": 3.504825392,
                "index": 877
              },
              {
                "eta": 4.236249202,
                "index": 883
              },
              {
                "eta": 0.805353816,
                "index": 908
              },
              {
                "eta": 2.861189536,
                "index": 933
              },
              {
                "eta": 0,
                "index": 950
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 51.667035621,
            "brakeI": 908,
            "cornerTimeSeconds": 3.210101477,
            "kind": "inside",
            "lapTimeLossSeconds": 0.137405436,
            "points": [
              {
                "eta": 3.3099069166536896,
                "index": 857
              },
              {
                "eta": 3.3099069166536896,
                "index": 883
              },
              {
                "eta": 3.309906917,
                "index": 908
              },
              {
                "eta": 3.3099069166536896,
                "index": 950
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 47.721641754,
            "brakeI": 901,
            "cornerTimeSeconds": 3.359882226,
            "kind": "outside",
            "lapTimeLossSeconds": 0.443465606,
            "points": [
              {
                "eta": 0,
                "index": 857
              },
              {
                "eta": 0.529825392,
                "index": 877
              },
              {
                "eta": 0.773749202,
                "index": 883
              },
              {
                "eta": -2.033708684,
                "index": 908
              },
              {
                "eta": 2.861189536,
                "index": 933
              },
              {
                "eta": 0,
                "index": 950
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 52.5485974,
            "brakeI": 908,
            "cornerTimeSeconds": 3.17031515,
            "kind": "outside",
            "lapTimeLossSeconds": -0.071766755,
            "points": [
              {
                "eta": -2.3950007977103818,
                "index": 857
              },
              {
                "eta": -2.3950007977103818,
                "index": 883
              },
              {
                "eta": -3.90301936,
                "index": 908
              },
              {
                "eta": -2.3950007977103818,
                "index": 950
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.944182045,
            "brakeI": 1165,
            "cornerTimeSeconds": 5.39775746,
            "kind": "inside",
            "lapTimeLossSeconds": 0.345355637,
            "points": [
              {
                "eta": 0,
                "index": 1119
              },
              {
                "eta": 3.569757003,
                "index": 1139
              },
              {
                "eta": 3.691785925,
                "index": 1145
              },
              {
                "eta": 0.385121328,
                "index": 1170
              },
              {
                "eta": 2.404137371,
                "index": 1195
              },
              {
                "eta": 0,
                "index": 1212
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.322939793,
            "brakeI": 1162,
            "cornerTimeSeconds": 5.194769462,
            "kind": "inside",
            "lapTimeLossSeconds": 0.026321881,
            "points": [
              {
                "eta": 0.38512132832873647,
                "index": 1119
              },
              {
                "eta": 0.38512132832873647,
                "index": 1145
              },
              {
                "eta": 0.385121328,
                "index": 1170
              },
              {
                "eta": 0.38512132832873647,
                "index": 1212
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.104045787,
            "brakeI": 1165,
            "cornerTimeSeconds": 5.573556159,
            "kind": "outside",
            "lapTimeLossSeconds": 0.399640705,
            "points": [
              {
                "eta": 0,
                "index": 1119
              },
              {
                "eta": -1.477117997,
                "index": 1139
              },
              {
                "eta": -1.842589075,
                "index": 1145
              },
              {
                "eta": -6.664878672,
                "index": 1170
              },
              {
                "eta": 2.404137371,
                "index": 1195
              },
              {
                "eta": 0,
                "index": 1212
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.64191793,
            "brakeI": 1166,
            "cornerTimeSeconds": 5.188978894,
            "kind": "outside",
            "lapTimeLossSeconds": -0.004299799,
            "points": [
              {
                "eta": -2.3300890754256396,
                "index": 1119
              },
              {
                "eta": -2.3300890754256396,
                "index": 1145
              },
              {
                "eta": -5.110642347,
                "index": 1170
              },
              {
                "eta": -2.3300890754256396,
                "index": 1212
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 55.467924175,
            "brakeI": 1259,
            "cornerTimeSeconds": 3.114824134,
            "kind": "inside",
            "lapTimeLossSeconds": 0.714352375,
            "points": [
              {
                "eta": 0,
                "index": 1219
              },
              {
                "eta": -1.5828315,
                "index": 1239
              },
              {
                "eta": -1.672361445,
                "index": 1245
              },
              {
                "eta": -2.377407844,
                "index": 1270
              },
              {
                "eta": -2.370356345,
                "index": 1285
              },
              {
                "eta": 0,
                "index": 1302
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.315331083,
            "brakeI": 1268,
            "cornerTimeSeconds": 2.791055805,
            "kind": "inside",
            "lapTimeLossSeconds": 0.485307925,
            "points": [
              {
                "eta": -2.2374353049509232,
                "index": 1219
              },
              {
                "eta": -2.2374353049509232,
                "index": 1245
              },
              {
                "eta": -2.237435305,
                "index": 1270
              },
              {
                "eta": -2.2374353049509232,
                "index": 1302
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 28.447866112,
            "brakeI": 1246,
            "cornerTimeSeconds": 4.106076424,
            "kind": "outside",
            "lapTimeLossSeconds": 1.749582674,
            "points": [
              {
                "eta": 0,
                "index": 1219
              },
              {
                "eta": 3.3421685,
                "index": 1239
              },
              {
                "eta": 3.862013555,
                "index": 1245
              },
              {
                "eta": 2.699154656,
                "index": 1270
              },
              {
                "eta": -2.370356345,
                "index": 1285
              },
              {
                "eta": 0,
                "index": 1302
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 66.25726067,
            "brakeI": 1270,
            "cornerTimeSeconds": 2.70233476,
            "kind": "outside",
            "lapTimeLossSeconds": -0.134168541,
            "points": [
              {
                "eta": 3.457003160501341,
                "index": 1219
              },
              {
                "eta": 3.457003160501341,
                "index": 1245
              },
              {
                "eta": 3.457003161,
                "index": 1270
              },
              {
                "eta": 3.457003160501341,
                "index": 1302
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 57.734360401,
            "brakeI": 1289,
            "cornerTimeSeconds": 3.286332627,
            "kind": "inside",
            "lapTimeLossSeconds": 0.257881363,
            "points": [
              {
                "eta": 0,
                "index": 1238
              },
              {
                "eta": 3.655332056,
                "index": 1258
              },
              {
                "eta": 3.906314695,
                "index": 1264
              },
              {
                "eta": 1.330955794,
                "index": 1289
              },
              {
                "eta": 1.779648325,
                "index": 1314
              },
              {
                "eta": 0,
                "index": 1331
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 61.364330124,
            "brakeI": 1282,
            "cornerTimeSeconds": 2.975484838,
            "kind": "inside",
            "lapTimeLossSeconds": 0.180300858,
            "points": [
              {
                "eta": 3.457003160501341,
                "index": 1238
              },
              {
                "eta": 3.457003160501341,
                "index": 1264
              },
              {
                "eta": 3.457003161,
                "index": 1289
              },
              {
                "eta": 3.457003160501341,
                "index": 1331
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 44.277939226,
            "brakeI": 1262,
            "cornerTimeSeconds": 3.440587512,
            "kind": "outside",
            "lapTimeLossSeconds": 0.642724977,
            "points": [
              {
                "eta": 0,
                "index": 1238
              },
              {
                "eta": -1.635292944,
                "index": 1258
              },
              {
                "eta": -1.749935305,
                "index": 1264
              },
              {
                "eta": -1.927637956,
                "index": 1289
              },
              {
                "eta": 1.779648325,
                "index": 1314
              },
              {
                "eta": 0,
                "index": 1331
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 56.760694409,
            "brakeI": 1289,
            "cornerTimeSeconds": 3.259109434,
            "kind": "outside",
            "lapTimeLossSeconds": 0.345606053,
            "points": [
              {
                "eta": -2.2374353049509232,
                "index": 1238
              },
              {
                "eta": -2.2374353049509232,
                "index": 1264
              },
              {
                "eta": -5.672126641,
                "index": 1289
              },
              {
                "eta": -2.2374353049509232,
                "index": 1331
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 25.112322925,
            "brakeI": 1501,
            "cornerTimeSeconds": 5.210544314,
            "kind": "inside",
            "lapTimeLossSeconds": 0.162898948,
            "points": [
              {
                "eta": 0,
                "index": 1479
              },
              {
                "eta": 3.530779496,
                "index": 1499
              },
              {
                "eta": 3.531297232,
                "index": 1505
              },
              {
                "eta": -1.51009182,
                "index": 1530
              },
              {
                "eta": 3.072983573,
                "index": 1555
              },
              {
                "eta": 0,
                "index": 1572
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.616292029,
            "brakeI": 1514,
            "cornerTimeSeconds": 5.167771605,
            "kind": "inside",
            "lapTimeLossSeconds": 0.121751344,
            "points": [
              {
                "eta": 2.8600236300544135,
                "index": 1479
              },
              {
                "eta": 2.8600236300544135,
                "index": 1505
              },
              {
                "eta": 2.86002363,
                "index": 1530
              },
              {
                "eta": 2.8600236300544135,
                "index": 1572
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.323469723,
            "brakeI": 1465,
            "cornerTimeSeconds": 5.015038885,
            "kind": "outside",
            "lapTimeLossSeconds": -0.262118368,
            "points": [
              {
                "eta": 0,
                "index": 1479
              },
              {
                "eta": -0.541095504,
                "index": 1499
              },
              {
                "eta": -0.662452768,
                "index": 1505
              },
              {
                "eta": -5.24602932,
                "index": 1530
              },
              {
                "eta": 3.072983573,
                "index": 1555
              },
              {
                "eta": 0,
                "index": 1572
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.140218258,
            "brakeI": 1473,
            "cornerTimeSeconds": 5.109338649,
            "kind": "outside",
            "lapTimeLossSeconds": -0.076800504,
            "points": [
              {
                "eta": -2.3687027675658467,
                "index": 1479
              },
              {
                "eta": -2.3687027675658467,
                "index": 1505
              },
              {
                "eta": -3.9764013,
                "index": 1530
              },
              {
                "eta": -2.3687027675658467,
                "index": 1572
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "anhembi-c13",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 31.383442365,
            "brakeI": 1547,
            "cornerTimeSeconds": 4.934772603,
            "kind": "inside",
            "lapTimeLossSeconds": -0.264870917,
            "points": [
              {
                "eta": 0,
                "index": 1491
              },
              {
                "eta": 3.061181783,
                "index": 1511
              },
              {
                "eta": 2.174453237,
                "index": 1517
              },
              {
                "eta": 7.249787363,
                "index": 1547
              },
              {
                "eta": 3.068899245,
                "index": 1564
              },
              {
                "eta": 0,
                "index": 1581
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.666666766,
            "brakeI": 1537,
            "cornerTimeSeconds": 5.22485697,
            "kind": "inside",
            "lapTimeLossSeconds": 0.099372987,
            "points": [
              {
                "eta": 2.8600236300544135,
                "index": 1491
              },
              {
                "eta": 2.8600236300544135,
                "index": 1517
              },
              {
                "eta": 2.86002363,
                "index": 1547
              },
              {
                "eta": 2.8600236300544135,
                "index": 1581
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 20.331136972,
            "brakeI": 1536,
            "cornerTimeSeconds": 5.426041953,
            "kind": "outside",
            "lapTimeLossSeconds": 0.260906249,
            "points": [
              {
                "eta": 0,
                "index": 1491
              },
              {
                "eta": -0.035693217,
                "index": 1511
              },
              {
                "eta": -0.800546763,
                "index": 1517
              },
              {
                "eta": 0.199787363,
                "index": 1547
              },
              {
                "eta": 3.068899245,
                "index": 1564
              },
              {
                "eta": 0,
                "index": 1581
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.984165514,
            "brakeI": 1537,
            "cornerTimeSeconds": 5.200152102,
            "kind": "outside",
            "lapTimeLossSeconds": -0.007432371,
            "points": [
              {
                "eta": -2.3687027675658467,
                "index": 1491
              },
              {
                "eta": -2.3687027675658467,
                "index": 1517
              },
              {
                "eta": -2.889301561,
                "index": 1547
              },
              {
                "eta": -2.3687027675658467,
                "index": 1581
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 70.690868791,
      "maximumTrackingError": 1.30674493,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 84.154166667
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 634,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "acceptable",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:2ac47c13",
    "trackId": "anhembi"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.007536232
      },
      {
        "lateral": 0,
        "sFraction": 0.023768116
      },
      {
        "lateral": 2.129053615750745,
        "sFraction": 0.066666667
      },
      {
        "lateral": -5.015935138067232,
        "sFraction": 0.082898551
      },
      {
        "lateral": 1.3106750398362057,
        "sFraction": 0.099130435
      },
      {
        "lateral": -1.459450803771615,
        "sFraction": 0.155362319
      },
      {
        "lateral": 2.3049869789695365,
        "sFraction": 0.171594203
      },
      {
        "lateral": -1.6976124414429068,
        "sFraction": 0.187826087
      },
      {
        "lateral": -2.0613643332663925,
        "sFraction": 0.27884058
      },
      {
        "lateral": 5.514735594671221,
        "sFraction": 0.295072464
      },
      {
        "lateral": -1.8102621165523307,
        "sFraction": 0.311304348
      },
      {
        "lateral": -2.0750681127980353,
        "sFraction": 0.344927536
      },
      {
        "lateral": 2.516708164354786,
        "sFraction": 0.36115942
      },
      {
        "lateral": -2.212216860586777,
        "sFraction": 0.377391304
      },
      {
        "lateral": -2.3488205652870238,
        "sFraction": 0.624347826
      },
      {
        "lateral": 2.7136255780002103,
        "sFraction": 0.64057971
      },
      {
        "lateral": -1.4646321449987592,
        "sFraction": 0.656811594
      },
      {
        "lateral": 2.0897818823205303,
        "sFraction": 0.72115942
      },
      {
        "lateral": -1.3329889376554636,
        "sFraction": 0.737391304
      },
      {
        "lateral": 0.6792585420142859,
        "sFraction": 0.753623188
      },
      {
        "lateral": -1.5870515496656294,
        "sFraction": 0.766376812
      },
      {
        "lateral": 1.3546157361939548,
        "sFraction": 0.782608696
      },
      {
        "lateral": -1.2702559697395193,
        "sFraction": 0.79884058
      },
      {
        "lateral": -2.1140842322818933,
        "sFraction": 0.864347826
      },
      {
        "lateral": 2.2581242312211542,
        "sFraction": 0.88057971
      },
      {
        "lateral": -1.2757913651922719,
        "sFraction": 0.896811594
      },
      {
        "lateral": 0,
        "sFraction": 0.937971014
      },
      {
        "lateral": 0,
        "sFraction": 0.992463768
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 0,
      "controllerValidations": 28,
      "evaluations": 28,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "cerro-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 34.817727009,
            "brakeI": 25,
            "cornerTimeSeconds": 6.500769988,
            "kind": "inside",
            "lapTimeLossSeconds": 0.992733697,
            "points": [
              {
                "eta": 0,
                "index": 9
              },
              {
                "eta": 1,
                "index": 29
              },
              {
                "eta": 0.449234939,
                "index": 68
              },
              {
                "eta": -0.482830086,
                "index": 86
              },
              {
                "eta": 5.276317162,
                "index": 136
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 36.567644531,
            "brakeI": 28,
            "cornerTimeSeconds": 5.616979734,
            "kind": "inside",
            "lapTimeLossSeconds": 0.02629796,
            "points": [
              {
                "eta": 2.2709463842492554,
                "index": 9
              },
              {
                "eta": 2.2709463842492554,
                "index": 68
              },
              {
                "eta": 2.270946384,
                "index": 86
              },
              {
                "eta": 2.2709463842492554,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 35.349084813,
            "brakeI": 25,
            "cornerTimeSeconds": 6.28024706,
            "kind": "outside",
            "lapTimeLossSeconds": 0.772210769,
            "points": [
              {
                "eta": 0,
                "index": 9
              },
              {
                "eta": -1.425,
                "index": 29
              },
              {
                "eta": -3.675765061,
                "index": 68
              },
              {
                "eta": -2.482830086,
                "index": 86
              },
              {
                "eta": 5.276317162,
                "index": 136
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 37.657203549,
            "brakeI": 29,
            "cornerTimeSeconds": 5.607697757,
            "kind": "outside",
            "lapTimeLossSeconds": 0.003284326,
            "points": [
              {
                "eta": -0.12368283840220684,
                "index": 9
              },
              {
                "eta": -0.12368283840220684,
                "index": 68
              },
              {
                "eta": -0.123682838,
                "index": 86
              },
              {
                "eta": -0.12368283840220684,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 38.964882821,
            "brakeI": 110,
            "cornerTimeSeconds": 5.360701959,
            "kind": "inside",
            "lapTimeLossSeconds": 0.705414611,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": 1.334537193,
                "index": 62
              },
              {
                "eta": 1.617984939,
                "index": 68
              },
              {
                "eta": 2.589105041,
                "index": 120
              },
              {
                "eta": 5.276317162,
                "index": 136
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 51.755448804,
            "brakeI": 120,
            "cornerTimeSeconds": 4.773360703,
            "kind": "inside",
            "lapTimeLossSeconds": 0.085957957,
            "points": [
              {
                "eta": 2.2709463842492554,
                "index": 42
              },
              {
                "eta": 2.2709463842492554,
                "index": 68
              },
              {
                "eta": 2.270946384,
                "index": 120
              },
              {
                "eta": 2.2709463842492554,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.210015834,
            "brakeI": 101,
            "cornerTimeSeconds": 5.986741347,
            "kind": "outside",
            "lapTimeLossSeconds": 1.325737019,
            "points": [
              {
                "eta": 0,
                "index": 42
              },
              {
                "eta": -1.302962807,
                "index": 62
              },
              {
                "eta": -1.550765061,
                "index": 68
              },
              {
                "eta": -2.823394959,
                "index": 120
              },
              {
                "eta": 5.276317162,
                "index": 136
              },
              {
                "eta": 0,
                "index": 154
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 52.648343527,
            "brakeI": 120,
            "cornerTimeSeconds": 4.767581387,
            "kind": "outside",
            "lapTimeLossSeconds": 0.005050765,
            "points": [
              {
                "eta": -0.12368283840220684,
                "index": 42
              },
              {
                "eta": -0.12368283840220684,
                "index": 68
              },
              {
                "eta": -0.123682838,
                "index": 120
              },
              {
                "eta": -0.12368283840220684,
                "index": 154
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 31.059557694,
            "brakeI": 124,
            "cornerTimeSeconds": 4.859990266,
            "kind": "inside",
            "lapTimeLossSeconds": 0.300826265,
            "points": [
              {
                "eta": 0,
                "index": 89
              },
              {
                "eta": -3.11904042,
                "index": 109
              },
              {
                "eta": -3.129053616,
                "index": 115
              },
              {
                "eta": -0.534064862,
                "index": 143
              },
              {
                "eta": -2.31067504,
                "index": 171
              },
              {
                "eta": 0,
                "index": 189
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 34.426174196,
            "brakeI": 122,
            "cornerTimeSeconds": 4.476654873,
            "kind": "inside",
            "lapTimeLossSeconds": 0.008600875,
            "points": [
              {
                "eta": -0.12368283840220684,
                "index": 89
              },
              {
                "eta": -0.12368283840220684,
                "index": 115
              },
              {
                "eta": -0.123682838,
                "index": 143
              },
              {
                "eta": -0.12368283840220684,
                "index": 189
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.658104386,
            "brakeI": 128,
            "cornerTimeSeconds": 5.184164151,
            "kind": "outside",
            "lapTimeLossSeconds": 0.684506494,
            "points": [
              {
                "eta": 0,
                "index": 89
              },
              {
                "eta": -0.69404042,
                "index": 109
              },
              {
                "eta": -0.279053616,
                "index": 115
              },
              {
                "eta": 6.015935138,
                "index": 143
              },
              {
                "eta": -2.31067504,
                "index": 171
              },
              {
                "eta": 0,
                "index": 189
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 35.288705428,
            "brakeI": 143,
            "cornerTimeSeconds": 4.469985767,
            "kind": "outside",
            "lapTimeLossSeconds": 0.051032188,
            "points": [
              {
                "eta": 2.2709463842492554,
                "index": 89
              },
              {
                "eta": 2.2709463842492554,
                "index": 115
              },
              {
                "eta": 4.373235967,
                "index": 143
              },
              {
                "eta": 2.2709463842492554,
                "index": 189
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 44.586119798,
            "brakeI": 193,
            "cornerTimeSeconds": 3.314585305,
            "kind": "inside",
            "lapTimeLossSeconds": -0.768097445,
            "points": [
              {
                "eta": 0,
                "index": 158
              },
              {
                "eta": 1.186141226,
                "index": 178
              },
              {
                "eta": 2.016165585,
                "index": 187
              },
              {
                "eta": 4.039867311,
                "index": 205
              },
              {
                "eta": 0.994119715,
                "index": 218
              },
              {
                "eta": 0,
                "index": 236
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.53455985,
            "brakeI": 179,
            "cornerTimeSeconds": 4.145234521,
            "kind": "inside",
            "lapTimeLossSeconds": 0.262194653,
            "points": [
              {
                "eta": 3.0893249601637947,
                "index": 158
              },
              {
                "eta": 3.0893249601637947,
                "index": 187
              },
              {
                "eta": 3.656152677,
                "index": 205
              },
              {
                "eta": 3.0893249601637947,
                "index": 236
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 22.125270038,
            "brakeI": 181,
            "cornerTimeSeconds": 4.834013028,
            "kind": "outside",
            "lapTimeLossSeconds": 0.761855026,
            "points": [
              {
                "eta": 0,
                "index": 158
              },
              {
                "eta": -2.301358774,
                "index": 178
              },
              {
                "eta": -3.171334415,
                "index": 187
              },
              {
                "eta": -1.657007689,
                "index": 205
              },
              {
                "eta": 0.994119715,
                "index": 218
              },
              {
                "eta": 0,
                "index": 236
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.696628091,
            "brakeI": 205,
            "cornerTimeSeconds": 4.374270023,
            "kind": "outside",
            "lapTimeLossSeconds": 0.812076621,
            "points": [
              {
                "eta": -2.969588078096749,
                "index": 158
              },
              {
                "eta": -2.969588078096749,
                "index": 187
              },
              {
                "eta": -4.872433851,
                "index": 205
              },
              {
                "eta": -2.969588078096749,
                "index": 236
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 33.435704169,
            "brakeI": 246,
            "cornerTimeSeconds": 6.432799925,
            "kind": "inside",
            "lapTimeLossSeconds": -0.103313813,
            "points": [
              {
                "eta": 0,
                "index": 182
              },
              {
                "eta": -2.779827375,
                "index": 202
              },
              {
                "eta": -2.656202617,
                "index": 208
              },
              {
                "eta": -3.602822551,
                "index": 246
              },
              {
                "eta": -0.085269413,
                "index": 276
              },
              {
                "eta": 0,
                "index": 294
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 29.723075578,
            "brakeI": 232,
            "cornerTimeSeconds": 6.559240165,
            "kind": "inside",
            "lapTimeLossSeconds": 0.308449817,
            "points": [
              {
                "eta": -2.9421734912448914,
                "index": 182
              },
              {
                "eta": -2.9421734912448914,
                "index": 208
              },
              {
                "eta": -2.942173491,
                "index": 246
              },
              {
                "eta": -2.9421734912448914,
                "index": 294
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 29.905705234,
            "brakeI": 232,
            "cornerTimeSeconds": 6.62910756,
            "kind": "outside",
            "lapTimeLossSeconds": 0.089697232,
            "points": [
              {
                "eta": 0,
                "index": 182
              },
              {
                "eta": 1.779547625,
                "index": 202
              },
              {
                "eta": 2.329734883,
                "index": 208
              },
              {
                "eta": 2.236239949,
                "index": 246
              },
              {
                "eta": -0.085269413,
                "index": 276
              },
              {
                "eta": 0,
                "index": 294
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 32.685670898,
            "brakeI": 233,
            "cornerTimeSeconds": 6.689363215,
            "kind": "outside",
            "lapTimeLossSeconds": 0.521804851,
            "points": [
              {
                "eta": 3.1231630408204403,
                "index": 182
              },
              {
                "eta": 3.1231630408204403,
                "index": 208
              },
              {
                "eta": 5.521822204,
                "index": 246
              },
              {
                "eta": 3.1231630408204403,
                "index": 294
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 30.162662642,
            "brakeI": 267,
            "cornerTimeSeconds": 5.877390803,
            "kind": "inside",
            "lapTimeLossSeconds": -0.065468948,
            "points": [
              {
                "eta": 0,
                "index": 241
              },
              {
                "eta": 2.450134538,
                "index": 261
              },
              {
                "eta": 1.884420919,
                "index": 267
              },
              {
                "eta": 3.440819453,
                "index": 277
              },
              {
                "eta": 2.698057663,
                "index": 332
              },
              {
                "eta": 0,
                "index": 350
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.339330968,
            "brakeI": 277,
            "cornerTimeSeconds": 5.975088002,
            "kind": "inside",
            "lapTimeLossSeconds": 0.041597756,
            "points": [
              {
                "eta": 3.245013021030464,
                "index": 241
              },
              {
                "eta": 3.245013021030464,
                "index": 267
              },
              {
                "eta": 3.245013021,
                "index": 277
              },
              {
                "eta": 3.245013021030464,
                "index": 350
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 30.369521028,
            "brakeI": 265,
            "cornerTimeSeconds": 5.856315258,
            "kind": "outside",
            "lapTimeLossSeconds": -0.080243371,
            "points": [
              {
                "eta": 0,
                "index": 241
              },
              {
                "eta": 0.237634538,
                "index": 261
              },
              {
                "eta": -1.233547831,
                "index": 267
              },
              {
                "eta": -0.265430547,
                "index": 277
              },
              {
                "eta": 2.698057663,
                "index": 332
              },
              {
                "eta": 0,
                "index": 350
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.023580299,
            "brakeI": 277,
            "cornerTimeSeconds": 5.91690629,
            "kind": "outside",
            "lapTimeLossSeconds": 0.098075455,
            "points": [
              {
                "eta": -2.6896989394013318,
                "index": 241
              },
              {
                "eta": -2.6896989394013318,
                "index": 267
              },
              {
                "eta": -2.741527791,
                "index": 277
              },
              {
                "eta": -2.6896989394013318,
                "index": 350
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 27.870035422,
            "brakeI": 296,
            "cornerTimeSeconds": 5.53467449,
            "kind": "inside",
            "lapTimeLossSeconds": -0.098269498,
            "points": [
              {
                "eta": 0,
                "index": 242
              },
              {
                "eta": 2.878488054,
                "index": 262
              },
              {
                "eta": 3.871950804,
                "index": 268
              },
              {
                "eta": 1.965325521,
                "index": 296
              },
              {
                "eta": 2.697612441,
                "index": 324
              },
              {
                "eta": 0,
                "index": 342
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.737872071,
            "brakeI": 296,
            "cornerTimeSeconds": 5.616036014,
            "kind": "inside",
            "lapTimeLossSeconds": 0.046131111,
            "points": [
              {
                "eta": 3.245013021030464,
                "index": 242
              },
              {
                "eta": 3.245013021030464,
                "index": 268
              },
              {
                "eta": 3.245013021,
                "index": 296
              },
              {
                "eta": 3.245013021030464,
                "index": 342
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 26.003610549,
            "brakeI": 285,
            "cornerTimeSeconds": 5.786769046,
            "kind": "outside",
            "lapTimeLossSeconds": 0.217682977,
            "points": [
              {
                "eta": 0,
                "index": 242
              },
              {
                "eta": 0.453488054,
                "index": 262
              },
              {
                "eta": -0.115549196,
                "index": 268
              },
              {
                "eta": -3.304986979,
                "index": 296
              },
              {
                "eta": 2.697612441,
                "index": 324
              },
              {
                "eta": 0,
                "index": 342
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.720284579,
            "brakeI": 296,
            "cornerTimeSeconds": 5.557202709,
            "kind": "outside",
            "lapTimeLossSeconds": 0.07054106,
            "points": [
              {
                "eta": -2.697805248347602,
                "index": 242
              },
              {
                "eta": -2.697805248347602,
                "index": 268
              },
              {
                "eta": -2.712952096,
                "index": 296
              },
              {
                "eta": -2.697805248347602,
                "index": 342
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.241780551,
            "brakeI": 407,
            "cornerTimeSeconds": 6.292924922,
            "kind": "inside",
            "lapTimeLossSeconds": -0.101819456,
            "points": [
              {
                "eta": 0,
                "index": 388
              },
              {
                "eta": -0.052946751,
                "index": 408
              },
              {
                "eta": -0.142050246,
                "index": 443
              },
              {
                "eta": -2.642562493,
                "index": 460
              },
              {
                "eta": -1.088371698,
                "index": 483
              },
              {
                "eta": 0,
                "index": 501
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 17.459270796,
            "brakeI": 407,
            "cornerTimeSeconds": 6.399263954,
            "kind": "inside",
            "lapTimeLossSeconds": 0.022159822,
            "points": [
              {
                "eta": -2.338635666733608,
                "index": 388
              },
              {
                "eta": -2.338635666733608,
                "index": 443
              },
              {
                "eta": -2.338635667,
                "index": 460
              },
              {
                "eta": -2.338635666733608,
                "index": 501
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.323461565,
            "brakeI": 419,
            "cornerTimeSeconds": 6.567369472,
            "kind": "outside",
            "lapTimeLossSeconds": 0.185843522,
            "points": [
              {
                "eta": 0,
                "index": 388
              },
              {
                "eta": 2.903303249,
                "index": 408
              },
              {
                "eta": 5.364199754,
                "index": 443
              },
              {
                "eta": 3.054312507,
                "index": 460
              },
              {
                "eta": -0.769621698,
                "index": 483
              },
              {
                "eta": 0,
                "index": 501
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.347456522,
            "brakeI": 460,
            "cornerTimeSeconds": 6.970443869,
            "kind": "outside",
            "lapTimeLossSeconds": 0.654114917,
            "points": [
              {
                "eta": 1.131538280782121,
                "index": 388
              },
              {
                "eta": 1.131538280782121,
                "index": 443
              },
              {
                "eta": 7.426879636,
                "index": 460
              },
              {
                "eta": 1.131538280782121,
                "index": 501
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.069329995,
            "brakeI": 504,
            "cornerTimeSeconds": 7.048596537,
            "kind": "inside",
            "lapTimeLossSeconds": 0.148741817,
            "points": [
              {
                "eta": 0,
                "index": 455
              },
              {
                "eta": 3.061172764,
                "index": 475
              },
              {
                "eta": 3.592614333,
                "index": 481
              },
              {
                "eta": 0.035264405,
                "index": 509
              },
              {
                "eta": 2.810262117,
                "index": 537
              },
              {
                "eta": 0,
                "index": 555
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.499780957,
            "brakeI": 503,
            "cornerTimeSeconds": 6.809058769,
            "kind": "inside",
            "lapTimeLossSeconds": 0.001575782,
            "points": [
              {
                "eta": 0.03526440532878006,
                "index": 455
              },
              {
                "eta": 0.03526440532878006,
                "index": 481
              },
              {
                "eta": 0.035264405,
                "index": 509
              },
              {
                "eta": 0.03526440532878006,
                "index": 555
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.340368588,
            "brakeI": 503,
            "cornerTimeSeconds": 7.086099521,
            "kind": "outside",
            "lapTimeLossSeconds": 0.377508708,
            "points": [
              {
                "eta": 0,
                "index": 455
              },
              {
                "eta": -3.062264736,
                "index": 475
              },
              {
                "eta": -2.338635667,
                "index": 481
              },
              {
                "eta": -6.514735595,
                "index": 509
              },
              {
                "eta": 2.810262117,
                "index": 537
              },
              {
                "eta": 0,
                "index": 555
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.159920905,
            "brakeI": 503,
            "cornerTimeSeconds": 6.772834075,
            "kind": "outside",
            "lapTimeLossSeconds": -0.001361789,
            "points": [
              {
                "eta": -2.338635666733608,
                "index": 455
              },
              {
                "eta": -2.338635666733608,
                "index": 481
              },
              {
                "eta": -3.064091707,
                "index": 509
              },
              {
                "eta": -2.338635666733608,
                "index": 555
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 15.706133348,
            "brakeI": 583,
            "cornerTimeSeconds": 6.219153025,
            "kind": "inside",
            "lapTimeLossSeconds": 0.146638701,
            "points": [
              {
                "eta": 0,
                "index": 561
              },
              {
                "eta": 3.050008657,
                "index": 581
              },
              {
                "eta": 3.075068113,
                "index": 595
              },
              {
                "eta": 2.180166836,
                "index": 623
              },
              {
                "eta": 3.212216861,
                "index": 651
              },
              {
                "eta": 0,
                "index": 669
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 15.40341414,
            "brakeI": 580,
            "cornerTimeSeconds": 6.198290215,
            "kind": "inside",
            "lapTimeLossSeconds": 0.1375765,
            "points": [
              {
                "eta": 2.7674857531069375,
                "index": 561
              },
              {
                "eta": 2.7674857531069375,
                "index": 595
              },
              {
                "eta": 2.767485753,
                "index": 623
              },
              {
                "eta": 2.7674857531069375,
                "index": 669
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 18.06317241,
            "brakeI": 582,
            "cornerTimeSeconds": 6.306991371,
            "kind": "outside",
            "lapTimeLossSeconds": 0.217709601,
            "points": [
              {
                "eta": 0,
                "index": 561
              },
              {
                "eta": -2.243741343,
                "index": 581
              },
              {
                "eta": -2.324931887,
                "index": 595
              },
              {
                "eta": -3.516708164,
                "index": 623
              },
              {
                "eta": 3.212216861,
                "index": 651
              },
              {
                "eta": 0,
                "index": 669
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 18.603412785,
            "brakeI": 582,
            "cornerTimeSeconds": 6.060240361,
            "kind": "outside",
            "lapTimeLossSeconds": -0.062882296,
            "points": [
              {
                "eta": -2.187686509650563,
                "index": 561
              },
              {
                "eta": -2.187686509650563,
                "index": 595
              },
              {
                "eta": -2.18800592,
                "index": 623
              },
              {
                "eta": -2.187686509650563,
                "index": 669
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 15.281389949,
            "brakeI": 1057,
            "cornerTimeSeconds": 7.666675061,
            "kind": "inside",
            "lapTimeLossSeconds": 0.820884786,
            "points": [
              {
                "eta": 0,
                "index": 1004
              },
              {
                "eta": 3.346656424,
                "index": 1024
              },
              {
                "eta": 3.348820565,
                "index": 1077
              },
              {
                "eta": 1.414499422,
                "index": 1105
              },
              {
                "eta": 2.464632145,
                "index": 1133
              },
              {
                "eta": 0,
                "index": 1151
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 15.071902848,
            "brakeI": 1023,
            "cornerTimeSeconds": 7.149356812,
            "kind": "inside",
            "lapTimeLossSeconds": 0.084699947,
            "points": [
              {
                "eta": 2.0381130715995783,
                "index": 1004
              },
              {
                "eta": 2.0381130715995783,
                "index": 1077
              },
              {
                "eta": 2.038113072,
                "index": 1105
              },
              {
                "eta": 2.0381130715995783,
                "index": 1151
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 17.567502471,
            "brakeI": 1026,
            "cornerTimeSeconds": 7.203594611,
            "kind": "outside",
            "lapTimeLossSeconds": 0.1241135,
            "points": [
              {
                "eta": 0,
                "index": 1004
              },
              {
                "eta": -0.884593576,
                "index": 1024
              },
              {
                "eta": -1.201179435,
                "index": 1077
              },
              {
                "eta": -3.713625578,
                "index": 1105
              },
              {
                "eta": 2.464632145,
                "index": 1133
              },
              {
                "eta": 0,
                "index": 1151
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 18.775136722,
            "brakeI": 1026,
            "cornerTimeSeconds": 6.998794045,
            "kind": "outside",
            "lapTimeLossSeconds": -0.106354507,
            "points": [
              {
                "eta": -2.0511794347129766,
                "index": 1004
              },
              {
                "eta": -2.0511794347129766,
                "index": 1077
              },
              {
                "eta": -4.177043372,
                "index": 1105
              },
              {
                "eta": -2.0511794347129766,
                "index": 1151
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 64.771563994,
            "brakeI": 1272,
            "cornerTimeSeconds": 3.193435705,
            "kind": "inside",
            "lapTimeLossSeconds": 0.30424211,
            "points": [
              {
                "eta": 0,
                "index": 1218
              },
              {
                "eta": -3.297113463,
                "index": 1238
              },
              {
                "eta": -3.939781882,
                "index": 1244
              },
              {
                "eta": -2.004511062,
                "index": 1272
              },
              {
                "eta": -2.741758542,
                "index": 1300
              },
              {
                "eta": 0,
                "index": 1318
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.419129743,
            "brakeI": 1264,
            "cornerTimeSeconds": 3.654650346,
            "kind": "inside",
            "lapTimeLossSeconds": 1.84290487,
            "points": [
              {
                "eta": -2.9147171731801085,
                "index": 1218
              },
              {
                "eta": -2.9147171731801085,
                "index": 1244
              },
              {
                "eta": -3.067011062,
                "index": 1272
              },
              {
                "eta": -2.9147171731801085,
                "index": 1318
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 53.124043401,
            "brakeI": 1246,
            "cornerTimeSeconds": 3.24824697,
            "kind": "outside",
            "lapTimeLossSeconds": 0.382584793,
            "points": [
              {
                "eta": 0,
                "index": 1218
              },
              {
                "eta": 0.827886537,
                "index": 1238
              },
              {
                "eta": 1.035218118,
                "index": 1244
              },
              {
                "eta": 2.332988938,
                "index": 1272
              },
              {
                "eta": -1.679258542,
                "index": 1300
              },
              {
                "eta": 0,
                "index": 1318
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 67.098482542,
            "brakeI": 1259,
            "cornerTimeSeconds": 2.986108091,
            "kind": "outside",
            "lapTimeLossSeconds": 0.090973126,
            "points": [
              {
                "eta": 2.31021811767947,
                "index": 1218
              },
              {
                "eta": 2.31021811767947,
                "index": 1244
              },
              {
                "eta": 5.035348849,
                "index": 1272
              },
              {
                "eta": 2.31021811767947,
                "index": 1318
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c13",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 64.50276634,
            "brakeI": 1342,
            "cornerTimeSeconds": 3.15502439,
            "kind": "inside",
            "lapTimeLossSeconds": 0.123540209,
            "points": [
              {
                "eta": 0,
                "index": 1296
              },
              {
                "eta": 2.29487456,
                "index": 1316
              },
              {
                "eta": 2.58705155,
                "index": 1322
              },
              {
                "eta": 1.345384264,
                "index": 1350
              },
              {
                "eta": 2.27025597,
                "index": 1378
              },
              {
                "eta": 0,
                "index": 1396
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.565053961,
            "brakeI": 1348,
            "cornerTimeSeconds": 3.35368876,
            "kind": "inside",
            "lapTimeLossSeconds": 0.531834982,
            "points": [
              {
                "eta": 3.0453842638060458,
                "index": 1296
              },
              {
                "eta": 3.0453842638060458,
                "index": 1322
              },
              {
                "eta": 3.045384264,
                "index": 1350
              },
              {
                "eta": 3.0453842638060458,
                "index": 1396
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 49.099404351,
            "brakeI": 1323,
            "cornerTimeSeconds": 3.424147328,
            "kind": "outside",
            "lapTimeLossSeconds": 0.393493021,
            "points": [
              {
                "eta": 0,
                "index": 1296
              },
              {
                "eta": 0.29487456,
                "index": 1316
              },
              {
                "eta": -0.26294845,
                "index": 1322
              },
              {
                "eta": -2.354615736,
                "index": 1350
              },
              {
                "eta": 2.27025597,
                "index": 1378
              },
              {
                "eta": 0,
                "index": 1396
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 64.627289724,
            "brakeI": 1342,
            "cornerTimeSeconds": 3.196700265,
            "kind": "outside",
            "lapTimeLossSeconds": 0.345155708,
            "points": [
              {
                "eta": -2.812948450334371,
                "index": 1296
              },
              {
                "eta": -2.812948450334371,
                "index": 1322
              },
              {
                "eta": -3.634442196,
                "index": 1350
              },
              {
                "eta": -2.812948450334371,
                "index": 1396
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "cerro-c14",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 17.384255769,
            "brakeI": 1472,
            "cornerTimeSeconds": 6.612746551,
            "kind": "inside",
            "lapTimeLossSeconds": 0.32878914,
            "points": [
              {
                "eta": 0,
                "index": 1437
              },
              {
                "eta": 2.975483104,
                "index": 1457
              },
              {
                "eta": 3.114084232,
                "index": 1491
              },
              {
                "eta": 2.580938269,
                "index": 1519
              },
              {
                "eta": 2.275791365,
                "index": 1547
              },
              {
                "eta": 0,
                "index": 1565
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 16.688526041,
            "brakeI": 1456,
            "cornerTimeSeconds": 6.448606906,
            "kind": "inside",
            "lapTimeLossSeconds": 0.133067692,
            "points": [
              {
                "eta": 3.2918757687788465,
                "index": 1437
              },
              {
                "eta": 3.2918757687788465,
                "index": 1491
              },
              {
                "eta": 3.291875769,
                "index": 1519
              },
              {
                "eta": 3.2918757687788465,
                "index": 1565
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 19.273604846,
            "brakeI": 1458,
            "cornerTimeSeconds": 6.538859442,
            "kind": "outside",
            "lapTimeLossSeconds": 0.202952329,
            "points": [
              {
                "eta": 0,
                "index": 1437
              },
              {
                "eta": -1.680766896,
                "index": 1457
              },
              {
                "eta": -2.285915768,
                "index": 1491
              },
              {
                "eta": -3.258124231,
                "index": 1519
              },
              {
                "eta": 2.275791365,
                "index": 1547
              },
              {
                "eta": 0,
                "index": 1565
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.904834576,
            "brakeI": 1458,
            "cornerTimeSeconds": 6.359406634,
            "kind": "outside",
            "lapTimeLossSeconds": -0.020447132,
            "points": [
              {
                "eta": -2.285915767718107,
                "index": 1437
              },
              {
                "eta": -2.285915767718107,
                "index": 1491
              },
              {
                "eta": -4.264859401,
                "index": 1519
              },
              {
                "eta": -2.285915767718107,
                "index": 1565
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 69.445745449,
      "maximumTrackingError": 0.902426902,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 83.295833334
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 551,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "acceptable",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:445b4ff8",
    "trackId": "cerro"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.003694231
      },
      {
        "lateral": 0,
        "sFraction": 0.01562944
      },
      {
        "lateral": -2.2643304371863575,
        "sFraction": 0.171355499
      },
      {
        "lateral": 2.6463001322083106,
        "sFraction": 0.184143223
      },
      {
        "lateral": -1.40065041558548,
        "sFraction": 0.196930946
      },
      {
        "lateral": -1.868840067827019,
        "sFraction": 0.332196647
      },
      {
        "lateral": 2.282457300989403,
        "sFraction": 0.344984371
      },
      {
        "lateral": -1.482203764081539,
        "sFraction": 0.357772094
      },
      {
        "lateral": -1.9017423364647623,
        "sFraction": 0.372833191
      },
      {
        "lateral": 3.019354685730142,
        "sFraction": 0.385620915
      },
      {
        "lateral": -1.9030086836392737,
        "sFraction": 0.396135266
      },
      {
        "lateral": 1.1426751343305377,
        "sFraction": 0.399545325
      },
      {
        "lateral": -2.5489810771609664,
        "sFraction": 0.410059676
      },
      {
        "lateral": 2.027524419103907,
        "sFraction": 0.4228474
      },
      {
        "lateral": 1.8025126202655055,
        "sFraction": 0.565217391
      },
      {
        "lateral": -2.1443977331919797,
        "sFraction": 0.578005115
      },
      {
        "lateral": 1.7162266313605623,
        "sFraction": 0.590792839
      },
      {
        "lateral": -2.488149170525656,
        "sFraction": 0.605853936
      },
      {
        "lateral": 2.1705293829049936,
        "sFraction": 0.61864166
      },
      {
        "lateral": -1.771882055112104,
        "sFraction": 0.631429383
      },
      {
        "lateral": 1.5318394617651905,
        "sFraction": 0.876101165
      },
      {
        "lateral": -5.290837943244117,
        "sFraction": 0.888888889
      },
      {
        "lateral": 1.7521388382496434,
        "sFraction": 0.901676613
      },
      {
        "lateral": -2.418646592199987,
        "sFraction": 0.919579426
      },
      {
        "lateral": 2.5112419126999024,
        "sFraction": 0.93236715
      },
      {
        "lateral": -1.9644976360272617,
        "sFraction": 0.945154874
      },
      {
        "lateral": 0,
        "sFraction": 0.959647627
      },
      {
        "lateral": 1.597755905743688,
        "sFraction": 0.963910202
      },
      {
        "lateral": -3.177852909836918,
        "sFraction": 0.976697926
      },
      {
        "lateral": 1.646433123826608,
        "sFraction": 0.989485649
      },
      {
        "lateral": 0,
        "sFraction": 0.996305769
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 0,
      "controllerValidations": 40,
      "evaluations": 1202,
      "search": "deterministic-constrained-coordinate-pattern+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "ardenne-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 28.760725176,
            "brakeI": 648,
            "cornerTimeSeconds": 6.947962167,
            "kind": "inside",
            "lapTimeLossSeconds": 0.545048012,
            "points": [
              {
                "eta": 0,
                "index": 567
              },
              {
                "eta": 3.263791248,
                "index": 587
              },
              {
                "eta": 3.264196582,
                "index": 593
              },
              {
                "eta": 2.150762396,
                "index": 648
              },
              {
                "eta": 2.40069247,
                "index": 703
              },
              {
                "eta": 0,
                "index": 721
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.136093998,
            "brakeI": 626,
            "cornerTimeSeconds": 6.799944706,
            "kind": "inside",
            "lapTimeLossSeconds": 0.261432815,
            "points": [
              {
                "eta": 2.842664486056138,
                "index": 567
              },
              {
                "eta": 2.842664486056138,
                "index": 593
              },
              {
                "eta": 2.842664486,
                "index": 648
              },
              {
                "eta": 2.842664486056138,
                "index": 721
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 30.038800903,
            "brakeI": 627,
            "cornerTimeSeconds": 6.876764914,
            "kind": "outside",
            "lapTimeLossSeconds": 0.251714965,
            "points": [
              {
                "eta": 0,
                "index": 567
              },
              {
                "eta": -0.503793099,
                "index": 587
              },
              {
                "eta": -0.608636114,
                "index": 593
              },
              {
                "eta": -3.646300132,
                "index": 648
              },
              {
                "eta": 2.40069247,
                "index": 703
              },
              {
                "eta": 0,
                "index": 721
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.758534767,
            "brakeI": 648,
            "cornerTimeSeconds": 6.708264964,
            "kind": "outside",
            "lapTimeLossSeconds": -0.011325214,
            "points": [
              {
                "eta": -2.0631549627179018,
                "index": 567
              },
              {
                "eta": -2.0631549627179018,
                "index": 593
              },
              {
                "eta": -2.178217382,
                "index": 648
              },
              {
                "eta": -2.0631549627179018,
                "index": 721
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 69.559992159,
            "brakeI": 1214,
            "cornerTimeSeconds": 5.055410256,
            "kind": "inside",
            "lapTimeLossSeconds": 1.001787242,
            "points": [
              {
                "eta": 0,
                "index": 1133
              },
              {
                "eta": 3.311254936,
                "index": 1153
              },
              {
                "eta": 4.197398049,
                "index": 1159
              },
              {
                "eta": -0.836997884,
                "index": 1214
              },
              {
                "eta": 2.503010373,
                "index": 1269
              },
              {
                "eta": 0,
                "index": 1287
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 71.812905558,
            "brakeI": 1214,
            "cornerTimeSeconds": 4.495278156,
            "kind": "inside",
            "lapTimeLossSeconds": 0.089484466,
            "points": [
              {
                "eta": 2.2812180368097277,
                "index": 1133
              },
              {
                "eta": 2.2812180368097277,
                "index": 1159
              },
              {
                "eta": 2.281218037,
                "index": 1214
              },
              {
                "eta": 2.2812180368097277,
                "index": 1287
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 67.708419508,
            "brakeI": 1200,
            "cornerTimeSeconds": 4.528525367,
            "kind": "outside",
            "lapTimeLossSeconds": 0.235480115,
            "points": [
              {
                "eta": 0,
                "index": 1133
              },
              {
                "eta": -0.901664237,
                "index": 1153
              },
              {
                "eta": -0.902668702,
                "index": 1159
              },
              {
                "eta": -4.396105844,
                "index": 1214
              },
              {
                "eta": 2.503010373,
                "index": 1269
              },
              {
                "eta": 0,
                "index": 1287
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 72.710859021,
            "brakeI": 1214,
            "cornerTimeSeconds": 4.577106008,
            "kind": "outside",
            "lapTimeLossSeconds": 0.352637816,
            "points": [
              {
                "eta": -2.6660906664019333,
                "index": 1133
              },
              {
                "eta": -2.6660906664019333,
                "index": 1159
              },
              {
                "eta": -2.883486869,
                "index": 1214
              },
              {
                "eta": -2.6660906664019333,
                "index": 1287
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 63.825496729,
            "brakeI": 1214,
            "cornerTimeSeconds": 6.704495851,
            "kind": "inside",
            "lapTimeLossSeconds": 0.876297063,
            "points": [
              {
                "eta": 0,
                "index": 1126
              },
              {
                "eta": 3.531730202,
                "index": 1146
              },
              {
                "eta": 4.41751648,
                "index": 1152
              },
              {
                "eta": 3.93687312,
                "index": 1235
              },
              {
                "eta": 2.897704932,
                "index": 1314
              },
              {
                "eta": 0,
                "index": 1332
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 62.14926827,
            "brakeI": 1217,
            "cornerTimeSeconds": 6.138909418,
            "kind": "inside",
            "lapTimeLossSeconds": 0.181373555,
            "points": [
              {
                "eta": 2.2812180368097277,
                "index": 1126
              },
              {
                "eta": 2.2812180368097277,
                "index": 1152
              },
              {
                "eta": 2.281218037,
                "index": 1235
              },
              {
                "eta": 2.2812180368097277,
                "index": 1332
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 59.950301675,
            "brakeI": 1210,
            "cornerTimeSeconds": 6.259035288,
            "kind": "outside",
            "lapTimeLossSeconds": 0.167628652,
            "points": [
              {
                "eta": 0,
                "index": 1126
              },
              {
                "eta": 0.868349427,
                "index": 1146
              },
              {
                "eta": 0.868638051,
                "index": 1152
              },
              {
                "eta": -1.634721855,
                "index": 1235
              },
              {
                "eta": 2.897704932,
                "index": 1314
              },
              {
                "eta": 0,
                "index": 1332
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 63.090951709,
            "brakeI": 1218,
            "cornerTimeSeconds": 6.172703227,
            "kind": "outside",
            "lapTimeLossSeconds": 0.170394853,
            "points": [
              {
                "eta": -2.6646489145198267,
                "index": 1126
              },
              {
                "eta": -2.6646489145198267,
                "index": 1152
              },
              {
                "eta": -2.860386097,
                "index": 1235
              },
              {
                "eta": -2.6646489145198267,
                "index": 1332
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 22.159860228,
            "brakeI": 1357,
            "cornerTimeSeconds": 6.820884382,
            "kind": "inside",
            "lapTimeLossSeconds": 0.348674445,
            "points": [
              {
                "eta": 0,
                "index": 1276
              },
              {
                "eta": 2.832272966,
                "index": 1296
              },
              {
                "eta": 2.880935728,
                "index": 1302
              },
              {
                "eta": 2.00331144,
                "index": 1357
              },
              {
                "eta": 2.903008684,
                "index": 1394
              },
              {
                "eta": 0,
                "index": 1412
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.514024443,
            "brakeI": 1357,
            "cornerTimeSeconds": 6.615674242,
            "kind": "inside",
            "lapTimeLossSeconds": 0.250032938,
            "points": [
              {
                "eta": 1.8798854204039444,
                "index": 1276
              },
              {
                "eta": 1.8798854204039444,
                "index": 1302
              },
              {
                "eta": 1.87988542,
                "index": 1357
              },
              {
                "eta": 1.8798854204039444,
                "index": 1412
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.132923999,
            "brakeI": 1304,
            "cornerTimeSeconds": 6.733128157,
            "kind": "outside",
            "lapTimeLossSeconds": 0.189856366,
            "points": [
              {
                "eta": 0,
                "index": 1276
              },
              {
                "eta": -0.628033136,
                "index": 1296
              },
              {
                "eta": -0.917495467,
                "index": 1302
              },
              {
                "eta": -4.019354686,
                "index": 1357
              },
              {
                "eta": 2.903008684,
                "index": 1394
              },
              {
                "eta": 0,
                "index": 1412
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 24.680721756,
            "brakeI": 1357,
            "cornerTimeSeconds": 6.63664182,
            "kind": "outside",
            "lapTimeLossSeconds": 0.170027445,
            "points": [
              {
                "eta": -2.6983499312720687,
                "index": 1276
              },
              {
                "eta": -2.6983499312720687,
                "index": 1302
              },
              {
                "eta": -2.698349931,
                "index": 1357
              },
              {
                "eta": -2.6983499312720687,
                "index": 1412
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 22.050225681,
            "brakeI": 1443,
            "cornerTimeSeconds": 7.120655038,
            "kind": "inside",
            "lapTimeLossSeconds": 0.138754203,
            "points": [
              {
                "eta": 0,
                "index": 1380
              },
              {
                "eta": -4.026540129,
                "index": 1400
              },
              {
                "eta": -4.869737722,
                "index": 1406
              },
              {
                "eta": -2.501050224,
                "index": 1443
              },
              {
                "eta": -3.027507057,
                "index": 1498
              },
              {
                "eta": 0,
                "index": 1516
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.962721627,
            "brakeI": 1443,
            "cornerTimeSeconds": 7.232707474,
            "kind": "inside",
            "lapTimeLossSeconds": -0.072402427,
            "points": [
              {
                "eta": -2.6858109113274873,
                "index": 1380
              },
              {
                "eta": -2.6858109113274873,
                "index": 1406
              },
              {
                "eta": -2.685810911,
                "index": 1443
              },
              {
                "eta": -2.6858109113274873,
                "index": 1516
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.091637705,
            "brakeI": 1419,
            "cornerTimeSeconds": 7.328551503,
            "kind": "outside",
            "lapTimeLossSeconds": 0.346650668,
            "points": [
              {
                "eta": 0,
                "index": 1380
              },
              {
                "eta": 2.175065053,
                "index": 1400
              },
              {
                "eta": 1.902621807,
                "index": 1406
              },
              {
                "eta": 3.548981077,
                "index": 1443
              },
              {
                "eta": -3.027507057,
                "index": 1498
              },
              {
                "eta": 0,
                "index": 1516
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 24.554030023,
            "brakeI": 1443,
            "cornerTimeSeconds": 7.19582262,
            "kind": "outside",
            "lapTimeLossSeconds": 0.118260393,
            "points": [
              {
                "eta": 2.639483329842859,
                "index": 1380
              },
              {
                "eta": 2.639483329842859,
                "index": 1406
              },
              {
                "eta": 2.63948333,
                "index": 1443
              },
              {
                "eta": 2.639483329842859,
                "index": 1516
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 39.210370168,
            "brakeI": 2034,
            "cornerTimeSeconds": 5.995484331,
            "kind": "inside",
            "lapTimeLossSeconds": 0.834606633,
            "points": [
              {
                "eta": 0,
                "index": 1953
              },
              {
                "eta": -2.802582445,
                "index": 1973
              },
              {
                "eta": -2.802529982,
                "index": 1979
              },
              {
                "eta": -3.527373244,
                "index": 2034
              },
              {
                "eta": -2.50771469,
                "index": 2089
              },
              {
                "eta": 0,
                "index": 2107
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 39.036459616,
            "brakeI": 2034,
            "cornerTimeSeconds": 5.708806154,
            "kind": "inside",
            "lapTimeLossSeconds": 0.536614938,
            "points": [
              {
                "eta": -3.342544824754806,
                "index": 1953
              },
              {
                "eta": -3.342544824754806,
                "index": 1979
              },
              {
                "eta": -3.342544825,
                "index": 2034
              },
              {
                "eta": -3.342544824754806,
                "index": 2107
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 38.021435421,
            "brakeI": 1959,
            "cornerTimeSeconds": 5.96539201,
            "kind": "outside",
            "lapTimeLossSeconds": 0.624446488,
            "points": [
              {
                "eta": 0,
                "index": 1953
              },
              {
                "eta": 0.965665424,
                "index": 1973
              },
              {
                "eta": 1.185721285,
                "index": 1979
              },
              {
                "eta": 3.144397733,
                "index": 2034
              },
              {
                "eta": -2.50771469,
                "index": 2089
              },
              {
                "eta": 0,
                "index": 2107
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 42.310690269,
            "brakeI": 2034,
            "cornerTimeSeconds": 5.58698551,
            "kind": "outside",
            "lapTimeLossSeconds": 0.264100107,
            "points": [
              {
                "eta": 2.729111603336979,
                "index": 1953
              },
              {
                "eta": 2.729111603336979,
                "index": 1979
              },
              {
                "eta": 2.729111603,
                "index": 2034
              },
              {
                "eta": 2.729111603336979,
                "index": 2107
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 18.949338217,
            "brakeI": 2177,
            "cornerTimeSeconds": 8.42909805,
            "kind": "inside",
            "lapTimeLossSeconds": 0.183056814,
            "points": [
              {
                "eta": 0,
                "index": 2096
              },
              {
                "eta": 2.791966846,
                "index": 2116
              },
              {
                "eta": 3.279637229,
                "index": 2122
              },
              {
                "eta": 3.18675024,
                "index": 2177
              },
              {
                "eta": 2.771831193,
                "index": 2232
              },
              {
                "eta": 0,
                "index": 2250
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 18.651128092,
            "brakeI": 2177,
            "cornerTimeSeconds": 8.805465726,
            "kind": "inside",
            "lapTimeLossSeconds": 1.013592654,
            "points": [
              {
                "eta": 3.4772355478508206,
                "index": 2096
              },
              {
                "eta": 3.4772355478508206,
                "index": 2122
              },
              {
                "eta": 3.477235548,
                "index": 2177
              },
              {
                "eta": 3.4772355478508206,
                "index": 2250
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.504997292,
            "brakeI": 2124,
            "cornerTimeSeconds": 8.446076017,
            "kind": "outside",
            "lapTimeLossSeconds": 0.175166896,
            "points": [
              {
                "eta": 0,
                "index": 2096
              },
              {
                "eta": -0.742785461,
                "index": 2116
              },
              {
                "eta": -1.241017602,
                "index": 2122
              },
              {
                "eta": -3.170529383,
                "index": 2177
              },
              {
                "eta": 2.771831193,
                "index": 2232
              },
              {
                "eta": 0,
                "index": 2250
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 21.612048885,
            "brakeI": 2177,
            "cornerTimeSeconds": 8.302336011,
            "kind": "outside",
            "lapTimeLossSeconds": 0.012171848,
            "points": [
              {
                "eta": -2.0171701103849062,
                "index": 2096
              },
              {
                "eta": -2.0171701103849062,
                "index": 2122
              },
              {
                "eta": -2.01717011,
                "index": 2177
              },
              {
                "eta": -2.0171701103849062,
                "index": 2250
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 36.497105738,
            "brakeI": 3128,
            "cornerTimeSeconds": 5.981970148,
            "kind": "inside",
            "lapTimeLossSeconds": 0.667461179,
            "points": [
              {
                "eta": 0,
                "index": 3047
              },
              {
                "eta": -2.531633319,
                "index": 3067
              },
              {
                "eta": -2.531788599,
                "index": 3073
              },
              {
                "eta": 0.223482518,
                "index": 3128
              },
              {
                "eta": -2.622531536,
                "index": 3183
              },
              {
                "eta": 0,
                "index": 3201
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 37.211796222,
            "brakeI": 3128,
            "cornerTimeSeconds": 5.553414311,
            "kind": "inside",
            "lapTimeLossSeconds": 0.004120897,
            "points": [
              {
                "eta": -0.06395594191802179,
                "index": 3047
              },
              {
                "eta": -0.06395594191802179,
                "index": 3073
              },
              {
                "eta": -0.063955942,
                "index": 3128
              },
              {
                "eta": -0.06395594191802179,
                "index": 3201
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 36.742457449,
            "brakeI": 3049,
            "cornerTimeSeconds": 5.93573832,
            "kind": "outside",
            "lapTimeLossSeconds": 0.493642293,
            "points": [
              {
                "eta": 0,
                "index": 3047
              },
              {
                "eta": 0.619364287,
                "index": 3067
              },
              {
                "eta": 0.828072105,
                "index": 3073
              },
              {
                "eta": 6.290837943,
                "index": 3128
              },
              {
                "eta": -2.622531536,
                "index": 3183
              },
              {
                "eta": 0,
                "index": 3201
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.916708105,
            "brakeI": 3128,
            "cornerTimeSeconds": 5.64095736,
            "kind": "outside",
            "lapTimeLossSeconds": 0.495539976,
            "points": [
              {
                "eta": 2.5784181218107745,
                "index": 3047
              },
              {
                "eta": 2.5784181218107745,
                "index": 3073
              },
              {
                "eta": 2.578418122,
                "index": 3128
              },
              {
                "eta": 2.5784181218107745,
                "index": 3201
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 23.045466904,
            "brakeI": 3281,
            "cornerTimeSeconds": 7.577686079,
            "kind": "inside",
            "lapTimeLossSeconds": 0.103205403,
            "points": [
              {
                "eta": 0,
                "index": 3200
              },
              {
                "eta": 2.969264893,
                "index": 3220
              },
              {
                "eta": 3.28903929,
                "index": 3226
              },
              {
                "eta": 4.156841511,
                "index": 3281
              },
              {
                "eta": 2.85654358,
                "index": 3336
              },
              {
                "eta": 0,
                "index": 3354
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.764330407,
            "brakeI": 3281,
            "cornerTimeSeconds": 8.516445153,
            "kind": "inside",
            "lapTimeLossSeconds": 2.131486499,
            "points": [
              {
                "eta": 4.127370476889006,
                "index": 3200
              },
              {
                "eta": 4.127370476889006,
                "index": 3226
              },
              {
                "eta": 4.127370477,
                "index": 3281
              },
              {
                "eta": 4.127370476889006,
                "index": 3354
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 24.982390848,
            "brakeI": 3229,
            "cornerTimeSeconds": 7.716155267,
            "kind": "outside",
            "lapTimeLossSeconds": 0.236448273,
            "points": [
              {
                "eta": 0,
                "index": 3200
              },
              {
                "eta": -0.285676128,
                "index": 3220
              },
              {
                "eta": -0.695737393,
                "index": 3226
              },
              {
                "eta": -3.511241913,
                "index": 3281
              },
              {
                "eta": 2.85654358,
                "index": 3336
              },
              {
                "eta": 0,
                "index": 3354
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.974591121,
            "brakeI": 3281,
            "cornerTimeSeconds": 7.520476445,
            "kind": "outside",
            "lapTimeLossSeconds": 0.009238664,
            "points": [
              {
                "eta": -2.4053566913975732,
                "index": 3200
              },
              {
                "eta": -2.4053566913975732,
                "index": 3226
              },
              {
                "eta": -2.405356691,
                "index": 3281
              },
              {
                "eta": -2.4053566913975732,
                "index": 3354
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "ardenne-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 46.607594048,
            "brakeI": 3437,
            "cornerTimeSeconds": 5.390232716,
            "kind": "inside",
            "lapTimeLossSeconds": 0.314856111,
            "points": [
              {
                "eta": 0,
                "index": 3356
              },
              {
                "eta": -2.531106226,
                "index": 3376
              },
              {
                "eta": -2.560331486,
                "index": 3382
              },
              {
                "eta": -3.01667834,
                "index": 3437
              },
              {
                "eta": -2.075747453,
                "index": 3492
              },
              {
                "eta": 0,
                "index": 3510
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 45.813239482,
            "brakeI": 3437,
            "cornerTimeSeconds": 5.333046211,
            "kind": "inside",
            "lapTimeLossSeconds": 0.081625974,
            "points": [
              {
                "eta": -3.1889306772437536,
                "index": 3356
              },
              {
                "eta": -3.1889306772437536,
                "index": 3382
              },
              {
                "eta": -3.188930677,
                "index": 3437
              },
              {
                "eta": -3.1889306772437536,
                "index": 3510
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 44.046156856,
            "brakeI": 3404,
            "cornerTimeSeconds": 5.635191632,
            "kind": "outside",
            "lapTimeLossSeconds": 0.559815027,
            "points": [
              {
                "eta": 0,
                "index": 3356
              },
              {
                "eta": 1.918893774,
                "index": 3376
              },
              {
                "eta": 2.502168514,
                "index": 3382
              },
              {
                "eta": 3.60285291,
                "index": 3437
              },
              {
                "eta": -2.075747453,
                "index": 3492
              },
              {
                "eta": 0,
                "index": 3510
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 48.488730767,
            "brakeI": 3437,
            "cornerTimeSeconds": 5.356137239,
            "kind": "outside",
            "lapTimeLossSeconds": 0.543477886,
            "points": [
              {
                "eta": 4.253566876173393,
                "index": 3356
              },
              {
                "eta": 4.253566876173393,
                "index": 3382
              },
              {
                "eta": 4.253566876,
                "index": 3437
              },
              {
                "eta": 4.253566876173393,
                "index": 3510
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 109.324999099,
      "maximumTrackingError": 0.725912639,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 117.316666667
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 592,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 101
    },
    "schemaVersion": 1,
    "status": "normal",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:ecd083ce",
    "trackId": "ardenne"
  },
  {
    "anchors": [
      {
        "lateral": 0,
        "sFraction": 0.005506141
      },
      {
        "lateral": 0,
        "sFraction": 0.023295214
      },
      {
        "lateral": -2.109785140594099,
        "sFraction": 0.174925879
      },
      {
        "lateral": 2.9011885302219658,
        "sFraction": 0.189750106
      },
      {
        "lateral": -2.1535740395624106,
        "sFraction": 0.204574333
      },
      {
        "lateral": -2.4599313245188914,
        "sFraction": 0.217280813
      },
      {
        "lateral": 4.698242304804818,
        "sFraction": 0.23210504
      },
      {
        "lateral": -1.1949931109564629,
        "sFraction": 0.246929267
      },
      {
        "lateral": 1.99981045,
        "sFraction": 0.259635748
      },
      {
        "lateral": -3.1312749860764706,
        "sFraction": 0.274459975
      },
      {
        "lateral": 1.629797616111227,
        "sFraction": 0.289284202
      },
      {
        "lateral": -2.2766167888996462,
        "sFraction": 0.301990682
      },
      {
        "lateral": 3.114464718866543,
        "sFraction": 0.316814909
      },
      {
        "lateral": -2.2466202449076014,
        "sFraction": 0.331639136
      },
      {
        "lateral": -1.7029530789245315,
        "sFraction": 0.529436679
      },
      {
        "lateral": 2.9284367707579633,
        "sFraction": 0.544260906
      },
      {
        "lateral": -1.5391283674707772,
        "sFraction": 0.559085133
      },
      {
        "lateral": 2.2115201375086233,
        "sFraction": 0.607793308
      },
      {
        "lateral": -2.028123479910317,
        "sFraction": 0.622617535
      },
      {
        "lateral": 0.9514017010977497,
        "sFraction": 0.635747565
      },
      {
        "lateral": 1.8684248833348431,
        "sFraction": 0.639559509
      },
      {
        "lateral": -2.470496701,
        "sFraction": 0.652689538
      },
      {
        "lateral": 1.4596643429306613,
        "sFraction": 0.667090216
      },
      {
        "lateral": 1.8705783214865093,
        "sFraction": 0.671749259
      },
      {
        "lateral": -2.7612546693721782,
        "sFraction": 0.686149936
      },
      {
        "lateral": 1.6553716553910767,
        "sFraction": 0.700974163
      },
      {
        "lateral": -2.1496099901124497,
        "sFraction": 0.711986446
      },
      {
        "lateral": 1.8771251410369831,
        "sFraction": 0.726810673
      },
      {
        "lateral": -1.9193173853959302,
        "sFraction": 0.7416349
      },
      {
        "lateral": 2.1419533516010554,
        "sFraction": 0.757306226
      },
      {
        "lateral": -2.800250957773649,
        "sFraction": 0.772130453
      },
      {
        "lateral": 1.0216383922312742,
        "sFraction": 0.78695468
      },
      {
        "lateral": -1.8705408717770002,
        "sFraction": 0.799661161
      },
      {
        "lateral": 2.553332812684752,
        "sFraction": 0.814485388
      },
      {
        "lateral": -1.53566014,
        "sFraction": 0.829309615
      },
      {
        "lateral": -1.4574019584039224,
        "sFraction": 0.834392207
      },
      {
        "lateral": 2.6582462507395395,
        "sFraction": 0.849216434
      },
      {
        "lateral": -1.3165370829959666,
        "sFraction": 0.862770013
      },
      {
        "lateral": -0.858724203386958,
        "sFraction": 0.867429055
      },
      {
        "lateral": 1.9166384776376826,
        "sFraction": 0.880982634
      },
      {
        "lateral": -1.3503484470035443,
        "sFraction": 0.895806861
      },
      {
        "lateral": 0,
        "sFraction": 0.939855993
      },
      {
        "lateral": 0,
        "sFraction": 0.994493859
      }
    ],
    "cornerLineOptimizerVersion": "apex-grid-sustained-offset-v2",
    "cornerLineProvenance": {
      "backedOffLines": 1,
      "controllerValidations": 31,
      "evaluations": 28,
      "search": "committed-rejoin+surface-extreme-apex-grid+controller-finalists"
    },
    "cornerLines": [
      {
        "cornerId": "paulista-c01",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 22.978527625,
            "brakeI": 448,
            "cornerTimeSeconds": 5.997002054,
            "kind": "inside",
            "lapTimeLossSeconds": 0.377145919,
            "points": [
              {
                "eta": 0,
                "index": 387
              },
              {
                "eta": 3.109688299,
                "index": 407
              },
              {
                "eta": 3.109785141,
                "index": 413
              },
              {
                "eta": 1.892823748,
                "index": 448
              },
              {
                "eta": 3.15357404,
                "index": 483
              },
              {
                "eta": 0,
                "index": 501
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.905530678,
            "brakeI": 448,
            "cornerTimeSeconds": 5.855255963,
            "kind": "inside",
            "lapTimeLossSeconds": 0.266261736,
            "points": [
              {
                "eta": 2.561716599356268,
                "index": 387
              },
              {
                "eta": 2.561716599356268,
                "index": 413
              },
              {
                "eta": 2.561716599,
                "index": 448
              },
              {
                "eta": 2.561716599356268,
                "index": 501
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 23.605792508,
            "brakeI": 365,
            "cornerTimeSeconds": 6.038283594,
            "kind": "outside",
            "lapTimeLossSeconds": 0.208094058,
            "points": [
              {
                "eta": 0,
                "index": 387
              },
              {
                "eta": -0.547758071,
                "index": 407
              },
              {
                "eta": -0.726383285,
                "index": 413
              },
              {
                "eta": -3.90118853,
                "index": 448
              },
              {
                "eta": 3.15357404,
                "index": 483
              },
              {
                "eta": 0,
                "index": 501
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 25.525014888,
            "brakeI": 448,
            "cornerTimeSeconds": 5.846486114,
            "kind": "outside",
            "lapTimeLossSeconds": 0.148302058,
            "points": [
              {
                "eta": -2.0152171013277096,
                "index": 387
              },
              {
                "eta": -2.0152171013277096,
                "index": 413
              },
              {
                "eta": -2.73750512,
                "index": 448
              },
              {
                "eta": -2.0152171013277096,
                "index": 501
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c02",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 34.992511082,
            "brakeI": 548,
            "cornerTimeSeconds": 4.82800868,
            "kind": "inside",
            "lapTimeLossSeconds": 0.19047633,
            "points": [
              {
                "eta": 0,
                "index": 487
              },
              {
                "eta": 3.442187111,
                "index": 507
              },
              {
                "eta": 3.459931325,
                "index": 513
              },
              {
                "eta": 0.572676937,
                "index": 548
              },
              {
                "eta": 2.194993111,
                "index": 583
              },
              {
                "eta": 0,
                "index": 601
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 37.050760877,
            "brakeI": 548,
            "cornerTimeSeconds": 4.673989574,
            "kind": "inside",
            "lapTimeLossSeconds": 0.049355934,
            "points": [
              {
                "eta": 0.498023834066998,
                "index": 487
              },
              {
                "eta": 0.498023834066998,
                "index": 513
              },
              {
                "eta": 0.498023834,
                "index": 548
              },
              {
                "eta": 0.498023834066998,
                "index": 601
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 31.753542137,
            "brakeI": 520,
            "cornerTimeSeconds": 5.263450644,
            "kind": "outside",
            "lapTimeLossSeconds": 0.632603701,
            "points": [
              {
                "eta": 0,
                "index": 487
              },
              {
                "eta": -1.41090354,
                "index": 507
              },
              {
                "eta": -1.92505185,
                "index": 513
              },
              {
                "eta": -5.698242305,
                "index": 548
              },
              {
                "eta": 2.194993111,
                "index": 583
              },
              {
                "eta": 0,
                "index": 601
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.16178824,
            "brakeI": 548,
            "cornerTimeSeconds": 4.731133013,
            "kind": "outside",
            "lapTimeLossSeconds": 0.048276627,
            "points": [
              {
                "eta": -1.9245693179188037,
                "index": 487
              },
              {
                "eta": -1.9245693179188037,
                "index": 513
              },
              {
                "eta": -5.601926348,
                "index": 548
              },
              {
                "eta": -1.9245693179188037,
                "index": 601
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c03",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 20.391784753,
            "brakeI": 648,
            "cornerTimeSeconds": 6.132326977,
            "kind": "inside",
            "lapTimeLossSeconds": 0.042257474,
            "points": [
              {
                "eta": 0,
                "index": 587
              },
              {
                "eta": -2.814767428,
                "index": 607
              },
              {
                "eta": -2.99981045,
                "index": 613
              },
              {
                "eta": -2.194994299,
                "index": 648
              },
              {
                "eta": -2.629797616,
                "index": 683
              },
              {
                "eta": 0,
                "index": 701
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 20.279408323,
            "brakeI": 648,
            "cornerTimeSeconds": 6.125855227,
            "kind": "inside",
            "lapTimeLossSeconds": 0.055374514,
            "points": [
              {
                "eta": -2.4834122514664907,
                "index": 587
              },
              {
                "eta": -2.4834122514664907,
                "index": 613
              },
              {
                "eta": -2.483412251,
                "index": 648
              },
              {
                "eta": -2.4834122514664907,
                "index": 701
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.793582292,
            "brakeI": 605,
            "cornerTimeSeconds": 6.371029703,
            "kind": "outside",
            "lapTimeLossSeconds": 0.277107976,
            "points": [
              {
                "eta": 0,
                "index": 587
              },
              {
                "eta": 1.335533084,
                "index": 607
              },
              {
                "eta": 1.798458417,
                "index": 613
              },
              {
                "eta": 4.131274986,
                "index": 648
              },
              {
                "eta": -2.629797616,
                "index": 683
              },
              {
                "eta": 0,
                "index": 701
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 23.391587395,
            "brakeI": 648,
            "cornerTimeSeconds": 6.183271946,
            "kind": "outside",
            "lapTimeLossSeconds": 0.211533093,
            "points": [
              {
                "eta": 2.444212771297021,
                "index": 587
              },
              {
                "eta": 2.444212771297021,
                "index": 613
              },
              {
                "eta": 3.806554865,
                "index": 648
              },
              {
                "eta": 2.444212771297021,
                "index": 701
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c04",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 28.149354407,
            "brakeI": 748,
            "cornerTimeSeconds": 5.373975786,
            "kind": "inside",
            "lapTimeLossSeconds": 0.214547504,
            "points": [
              {
                "eta": 0,
                "index": 687
              },
              {
                "eta": 3.050357267,
                "index": 707
              },
              {
                "eta": 3.276616789,
                "index": 713
              },
              {
                "eta": 2.559262565,
                "index": 748
              },
              {
                "eta": 3.246620245,
                "index": 783
              },
              {
                "eta": 0,
                "index": 801
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 28.742184268,
            "brakeI": 748,
            "cornerTimeSeconds": 5.291638258,
            "kind": "inside",
            "lapTimeLossSeconds": 0.020789212,
            "points": [
              {
                "eta": 2.3865675356707343,
                "index": 687
              },
              {
                "eta": 2.3865675356707343,
                "index": 713
              },
              {
                "eta": 2.386567536,
                "index": 748
              },
              {
                "eta": 2.3865675356707343,
                "index": 801
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.347646771,
            "brakeI": 716,
            "cornerTimeSeconds": 5.730664613,
            "kind": "outside",
            "lapTimeLossSeconds": 0.571236331,
            "points": [
              {
                "eta": 0,
                "index": 687
              },
              {
                "eta": 0.175477051,
                "index": 707
              },
              {
                "eta": -0.474914845,
                "index": 713
              },
              {
                "eta": -4.114464719,
                "index": 748
              },
              {
                "eta": 3.246620245,
                "index": 783
              },
              {
                "eta": 0,
                "index": 801
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 31.078669501,
            "brakeI": 748,
            "cornerTimeSeconds": 5.283252799,
            "kind": "outside",
            "lapTimeLossSeconds": 0.054985465,
            "points": [
              {
                "eta": -2.2264464788143443,
                "index": 687
              },
              {
                "eta": -2.2264464788143443,
                "index": 713
              },
              {
                "eta": -2.510602821,
                "index": 748
              },
              {
                "eta": -2.2264464788143443,
                "index": 801
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c05",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 19.289267054,
            "brakeI": 1285,
            "cornerTimeSeconds": 6.907370745,
            "kind": "inside",
            "lapTimeLossSeconds": 0.092542029,
            "points": [
              {
                "eta": 0,
                "index": 1224
              },
              {
                "eta": 2.702964388,
                "index": 1244
              },
              {
                "eta": 2.926388123,
                "index": 1250
              },
              {
                "eta": 2.633482154,
                "index": 1285
              },
              {
                "eta": 3.757101476,
                "index": 1320
              },
              {
                "eta": 0,
                "index": 1338
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 19.494255953,
            "brakeI": 1285,
            "cornerTimeSeconds": 6.875813424,
            "kind": "inside",
            "lapTimeLossSeconds": 0.081014907,
            "points": [
              {
                "eta": 2.7806408295324716,
                "index": 1224
              },
              {
                "eta": 2.7806408295324716,
                "index": 1250
              },
              {
                "eta": 2.78064083,
                "index": 1285
              },
              {
                "eta": 2.7806408295324716,
                "index": 1338
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 21.23392079,
            "brakeI": 1195,
            "cornerTimeSeconds": 7.080557798,
            "kind": "outside",
            "lapTimeLossSeconds": 0.137301804,
            "points": [
              {
                "eta": 0,
                "index": 1224
              },
              {
                "eta": -0.862272151,
                "index": 1244
              },
              {
                "eta": -1.084527271,
                "index": 1250
              },
              {
                "eta": -3.928436771,
                "index": 1285
              },
              {
                "eta": 2.539128367,
                "index": 1320
              },
              {
                "eta": 0,
                "index": 1338
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 22.548180966,
            "brakeI": 1285,
            "cornerTimeSeconds": 6.99576048,
            "kind": "outside",
            "lapTimeLossSeconds": 0.156906326,
            "points": [
              {
                "eta": -2.8720076217470965,
                "index": 1224
              },
              {
                "eta": -2.8720076217470965,
                "index": 1250
              },
              {
                "eta": -3.375776679,
                "index": 1285
              },
              {
                "eta": -2.8720076217470965,
                "index": 1338
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c06",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 44.462568036,
            "brakeI": 1470,
            "cornerTimeSeconds": 4.545826632,
            "kind": "inside",
            "lapTimeLossSeconds": 0.018659685,
            "points": [
              {
                "eta": 0,
                "index": 1409
              },
              {
                "eta": -3.206601515,
                "index": 1429
              },
              {
                "eta": -3.979049436,
                "index": 1435
              },
              {
                "eta": -0.565567591,
                "index": 1470
              },
              {
                "eta": -1.951401701,
                "index": 1501
              },
              {
                "eta": 0,
                "index": 1519
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 45.438083086,
            "brakeI": 1463,
            "cornerTimeSeconds": 4.69806923,
            "kind": "inside",
            "lapTimeLossSeconds": 0.405422517,
            "points": [
              {
                "eta": -3.621640803191157,
                "index": 1409
              },
              {
                "eta": -3.621640803191157,
                "index": 1435
              },
              {
                "eta": -3.621640803,
                "index": 1470
              },
              {
                "eta": -3.621640803191157,
                "index": 1519
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 39.415951958,
            "brakeI": 1450,
            "cornerTimeSeconds": 4.592989964,
            "kind": "outside",
            "lapTimeLossSeconds": 0.019043819,
            "points": [
              {
                "eta": 0,
                "index": 1409
              },
              {
                "eta": -0.877516692,
                "index": 1429
              },
              {
                "eta": -1.211520138,
                "index": 1435
              },
              {
                "eta": 2.45312348,
                "index": 1470
              },
              {
                "eta": -1.951401701,
                "index": 1501
              },
              {
                "eta": 0,
                "index": 1519
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 46.6555556,
            "brakeI": 1455,
            "cornerTimeSeconds": 4.556600254,
            "kind": "outside",
            "lapTimeLossSeconds": -0.086462869,
            "points": [
              {
                "eta": 2.2971852233635044,
                "index": 1409
              },
              {
                "eta": 2.2971852233635044,
                "index": 1435
              },
              {
                "eta": 5.131822028,
                "index": 1470
              },
              {
                "eta": 2.2971852233635044,
                "index": 1519
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c07",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 54.003115042,
            "brakeI": 1541,
            "cornerTimeSeconds": 4.72139673,
            "kind": "inside",
            "lapTimeLossSeconds": 0.816869728,
            "points": [
              {
                "eta": 0,
                "index": 1484
              },
              {
                "eta": -2.143863357,
                "index": 1504
              },
              {
                "eta": -2.868424883,
                "index": 1510
              },
              {
                "eta": -0.118659966,
                "index": 1541
              },
              {
                "eta": -2.459664343,
                "index": 1575
              },
              {
                "eta": 0,
                "index": 1593
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 57.16023139,
            "brakeI": 1536,
            "cornerTimeSeconds": 4.266070566,
            "kind": "inside",
            "lapTimeLossSeconds": -0.000754531,
            "points": [
              {
                "eta": -2.2429939997033617,
                "index": 1484
              },
              {
                "eta": -2.2429939997033617,
                "index": 1510
              },
              {
                "eta": -2.242994,
                "index": 1541
              },
              {
                "eta": -2.2429939997033617,
                "index": 1593
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 48.57135024,
            "brakeI": 1527,
            "cornerTimeSeconds": 4.358928984,
            "kind": "outside",
            "lapTimeLossSeconds": 0.239752188,
            "points": [
              {
                "eta": 0,
                "index": 1484
              },
              {
                "eta": 1.492579767,
                "index": 1504
              },
              {
                "eta": 1.639686239,
                "index": 1510
              },
              {
                "eta": 2.895496701,
                "index": 1541
              },
              {
                "eta": -2.459664343,
                "index": 1575
              },
              {
                "eta": 0,
                "index": 1593
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 58.316618039,
            "brakeI": 1536,
            "cornerTimeSeconds": 4.291904478,
            "kind": "outside",
            "lapTimeLossSeconds": 0.268946436,
            "points": [
              {
                "eta": 2.599552675289366,
                "index": 1484
              },
              {
                "eta": 2.599552675289366,
                "index": 1510
              },
              {
                "eta": 2.599552675,
                "index": 1541
              },
              {
                "eta": 2.599552675289366,
                "index": 1593
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c08",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 54.585370801,
            "brakeI": 1620,
            "cornerTimeSeconds": 4.549321977,
            "kind": "inside",
            "lapTimeLossSeconds": 0.625887186,
            "points": [
              {
                "eta": 0,
                "index": 1560
              },
              {
                "eta": -2.63029273,
                "index": 1580
              },
              {
                "eta": -3.087461508,
                "index": 1586
              },
              {
                "eta": -0.075134512,
                "index": 1620
              },
              {
                "eta": -2.655371655,
                "index": 1655
              },
              {
                "eta": 0,
                "index": 1673
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 58.234861093,
            "brakeI": 1613,
            "cornerTimeSeconds": 4.149599951,
            "kind": "inside",
            "lapTimeLossSeconds": 0.125061062,
            "points": [
              {
                "eta": -1.9916415860520633,
                "index": 1560
              },
              {
                "eta": -1.9916415860520633,
                "index": 1586
              },
              {
                "eta": -1.991641586,
                "index": 1620
              },
              {
                "eta": -1.9916415860520633,
                "index": 1673
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 49.108453274,
            "brakeI": 1602,
            "cornerTimeSeconds": 4.178276241,
            "kind": "outside",
            "lapTimeLossSeconds": -0.002910032,
            "points": [
              {
                "eta": 0,
                "index": 1560
              },
              {
                "eta": 1.214028639,
                "index": 1580
              },
              {
                "eta": 1.406695146,
                "index": 1586
              },
              {
                "eta": 3.186254669,
                "index": 1620
              },
              {
                "eta": -2.655371655,
                "index": 1655
              },
              {
                "eta": 0,
                "index": 1673
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 58.760337621,
            "brakeI": 1611,
            "cornerTimeSeconds": 4.15245534,
            "kind": "outside",
            "lapTimeLossSeconds": 0.120036724,
            "points": [
              {
                "eta": 2.599552675289366,
                "index": 1560
              },
              {
                "eta": 2.599552675289366,
                "index": 1586
              },
              {
                "eta": 3.315787776,
                "index": 1620
              },
              {
                "eta": 2.599552675289366,
                "index": 1673
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c09",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 30.995662199,
            "brakeI": 1716,
            "cornerTimeSeconds": 5.101332841,
            "kind": "inside",
            "lapTimeLossSeconds": 0.107484464,
            "points": [
              {
                "eta": 0,
                "index": 1655
              },
              {
                "eta": 2.828921772,
                "index": 1675
              },
              {
                "eta": 3.14960999,
                "index": 1681
              },
              {
                "eta": 3.566454848,
                "index": 1716
              },
              {
                "eta": 2.919317385,
                "index": 1751
              },
              {
                "eta": 0,
                "index": 1769
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.872387973,
            "brakeI": 1716,
            "cornerTimeSeconds": 5.192371832,
            "kind": "inside",
            "lapTimeLossSeconds": 0.30123025,
            "points": [
              {
                "eta": 2.797132645208365,
                "index": 1655
              },
              {
                "eta": 2.797132645208365,
                "index": 1681
              },
              {
                "eta": 3.409108053,
                "index": 1716
              },
              {
                "eta": 2.797132645208365,
                "index": 1769
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 29.201503796,
            "brakeI": 1679,
            "cornerTimeSeconds": 5.463472643,
            "kind": "outside",
            "lapTimeLossSeconds": 0.469624265,
            "points": [
              {
                "eta": 0,
                "index": 1655
              },
              {
                "eta": -0.248389201,
                "index": 1675
              },
              {
                "eta": -0.681004387,
                "index": 1681
              },
              {
                "eta": -2.877125141,
                "index": 1716
              },
              {
                "eta": 2.919317385,
                "index": 1751
              },
              {
                "eta": 0,
                "index": 1769
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 33.553890181,
            "brakeI": 1716,
            "cornerTimeSeconds": 5.090234928,
            "kind": "outside",
            "lapTimeLossSeconds": 0.180581504,
            "points": [
              {
                "eta": -2.2962523670002204,
                "index": 1655
              },
              {
                "eta": -2.2962523670002204,
                "index": 1681
              },
              {
                "eta": -3.04918224,
                "index": 1716
              },
              {
                "eta": -2.2962523670002204,
                "index": 1769
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c10",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 27.827090966,
            "brakeI": 1823,
            "cornerTimeSeconds": 5.404094782,
            "kind": "inside",
            "lapTimeLossSeconds": 0.026647283,
            "points": [
              {
                "eta": 0,
                "index": 1762
              },
              {
                "eta": -3.008161854,
                "index": 1782
              },
              {
                "eta": -3.141953352,
                "index": 1788
              },
              {
                "eta": -2.616849072,
                "index": 1823
              },
              {
                "eta": -2.021638392,
                "index": 1858
              },
              {
                "eta": 0,
                "index": 1876
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 27.457053114,
            "brakeI": 1823,
            "cornerTimeSeconds": 5.426524578,
            "kind": "inside",
            "lapTimeLossSeconds": 0.056766076,
            "points": [
              {
                "eta": -2.7203674451900564,
                "index": 1762
              },
              {
                "eta": -2.7203674451900564,
                "index": 1788
              },
              {
                "eta": -2.720367445,
                "index": 1823
              },
              {
                "eta": -2.7203674451900564,
                "index": 1876
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 27.174896563,
            "brakeI": 1786,
            "cornerTimeSeconds": 5.694720641,
            "kind": "outside",
            "lapTimeLossSeconds": 0.312712694,
            "points": [
              {
                "eta": 0,
                "index": 1762
              },
              {
                "eta": 1.450006962,
                "index": 1782
              },
              {
                "eta": 1.956087834,
                "index": 1788
              },
              {
                "eta": 3.800250958,
                "index": 1823
              },
              {
                "eta": -2.021638392,
                "index": 1858
              },
              {
                "eta": 0,
                "index": 1876
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 30.654136378,
            "brakeI": 1823,
            "cornerTimeSeconds": 5.511639021,
            "kind": "outside",
            "lapTimeLossSeconds": 0.267845878,
            "points": [
              {
                "eta": 2.276574853469899,
                "index": 1762
              },
              {
                "eta": 2.276574853469899,
                "index": 1788
              },
              {
                "eta": 5.21801451,
                "index": 1823
              },
              {
                "eta": 2.276574853469899,
                "index": 1876
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c11",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 58.028955408,
            "brakeI": 1923,
            "cornerTimeSeconds": 4.658820964,
            "kind": "inside",
            "lapTimeLossSeconds": 0.282320931,
            "points": [
              {
                "eta": 0,
                "index": 1862
              },
              {
                "eta": 2.703025849,
                "index": 1882
              },
              {
                "eta": 2.870540872,
                "index": 1888
              },
              {
                "eta": 0.506307634,
                "index": 1923
              },
              {
                "eta": 3.11066014,
                "index": 1958
              },
              {
                "eta": 0,
                "index": 1976
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 58.749190125,
            "brakeI": 1913,
            "cornerTimeSeconds": 4.417131012,
            "kind": "inside",
            "lapTimeLossSeconds": -0.225010557,
            "points": [
              {
                "eta": 1.8558745134767989,
                "index": 1862
              },
              {
                "eta": 1.8558745134767989,
                "index": 1888
              },
              {
                "eta": 1.855874513,
                "index": 1923
              },
              {
                "eta": 1.8558745134767989,
                "index": 1976
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 52.166413973,
            "brakeI": 1907,
            "cornerTimeSeconds": 4.731120974,
            "kind": "outside",
            "lapTimeLossSeconds": 0.354620942,
            "points": [
              {
                "eta": 0,
                "index": 1862
              },
              {
                "eta": -0.357760096,
                "index": 1882
              },
              {
                "eta": -0.825950262,
                "index": 1888
              },
              {
                "eta": -2.978332813,
                "index": 1923
              },
              {
                "eta": 3.11066014,
                "index": 1958
              },
              {
                "eta": 0,
                "index": 1976
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 60.010733079,
            "brakeI": 1916,
            "cornerTimeSeconds": 4.650419013,
            "kind": "outside",
            "lapTimeLossSeconds": 0.52059541,
            "points": [
              {
                "eta": -2.522441396806369,
                "index": 1862
              },
              {
                "eta": -2.522441396806369,
                "index": 1888
              },
              {
                "eta": -3.59583782,
                "index": 1923
              },
              {
                "eta": -2.522441396806369,
                "index": 1976
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c12",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 36.593923271,
            "brakeI": 1977,
            "cornerTimeSeconds": 11.041852917,
            "kind": "inside",
            "lapTimeLossSeconds": 0.790678106,
            "points": [
              {
                "eta": 0,
                "index": 1869
              },
              {
                "eta": 2.869552779,
                "index": 1889
              },
              {
                "eta": 2.614310108,
                "index": 1895
              },
              {
                "eta": 2.794023614,
                "index": 1977
              },
              {
                "eta": 1.754167571,
                "index": 2104
              },
              {
                "eta": 0,
                "index": 2122
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 36.956060558,
            "brakeI": 1977,
            "cornerTimeSeconds": 10.250128862,
            "kind": "inside",
            "lapTimeLossSeconds": -0.010986587,
            "points": [
              {
                "eta": 1.8558745134767989,
                "index": 1869
              },
              {
                "eta": 1.8558745134767989,
                "index": 1895
              },
              {
                "eta": 1.855874513,
                "index": 1977
              },
              {
                "eta": 1.8558745134767989,
                "index": 2122
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 37.390649456,
            "brakeI": 1977,
            "cornerTimeSeconds": 10.244039028,
            "kind": "outside",
            "lapTimeLossSeconds": -0.015881177,
            "points": [
              {
                "eta": 0,
                "index": 1869
              },
              {
                "eta": -1.038856051,
                "index": 1889
              },
              {
                "eta": -1.081286919,
                "index": 1895
              },
              {
                "eta": 0.794023614,
                "index": 1977
              },
              {
                "eta": 1.754167571,
                "index": 2104
              },
              {
                "eta": 0,
                "index": 2122
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 38.927383166,
            "brakeI": 1977,
            "cornerTimeSeconds": 10.335273299,
            "kind": "outside",
            "lapTimeLossSeconds": 0.099006128,
            "points": [
              {
                "eta": -2.522441396806369,
                "index": 1869
              },
              {
                "eta": -2.522441396806369,
                "index": 1895
              },
              {
                "eta": -2.863425311,
                "index": 1977
              },
              {
                "eta": -2.522441396806369,
                "index": 2122
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c13",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 45.253890476,
            "brakeI": 2005,
            "cornerTimeSeconds": 5.405376692,
            "kind": "inside",
            "lapTimeLossSeconds": 0.93404744,
            "points": [
              {
                "eta": 0,
                "index": 1944
              },
              {
                "eta": 3.071531049,
                "index": 1964
              },
              {
                "eta": 3.032401958,
                "index": 1970
              },
              {
                "eta": -0.590984561,
                "index": 2005
              },
              {
                "eta": 2.891537083,
                "index": 2037
              },
              {
                "eta": 0,
                "index": 2055
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 47.517919542,
            "brakeI": 2005,
            "cornerTimeSeconds": 5.255047086,
            "kind": "inside",
            "lapTimeLossSeconds": 0.292255702,
            "points": [
              {
                "eta": 2.854847272153357,
                "index": 1944
              },
              {
                "eta": 2.854847272153357,
                "index": 1970
              },
              {
                "eta": 2.854847272,
                "index": 2005
              },
              {
                "eta": 2.854847272153357,
                "index": 2055
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 39.905326573,
            "brakeI": 1991,
            "cornerTimeSeconds": 5.307029605,
            "kind": "outside",
            "lapTimeLossSeconds": 0.539387231,
            "points": [
              {
                "eta": 0,
                "index": 1944
              },
              {
                "eta": -0.65596717,
                "index": 1964
              },
              {
                "eta": -0.69442568,
                "index": 1970
              },
              {
                "eta": -3.083246251,
                "index": 2005
              },
              {
                "eta": 2.891537083,
                "index": 2037
              },
              {
                "eta": 0,
                "index": 2055
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 49.684126749,
            "brakeI": 2005,
            "cornerTimeSeconds": 5.309022808,
            "kind": "outside",
            "lapTimeLossSeconds": 0.581355004,
            "points": [
              {
                "eta": -2.8394399730420607,
                "index": 1944
              },
              {
                "eta": -2.8394399730420607,
                "index": 1970
              },
              {
                "eta": -3.486249426,
                "index": 2005
              },
              {
                "eta": -2.8394399730420607,
                "index": 2055
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      },
      {
        "cornerId": "paulista-c14",
        "inside": {
          "idealRejoin": {
            "apexSpeed": 56.729528503,
            "brakeI": 2080,
            "cornerTimeSeconds": 4.542242329,
            "kind": "inside",
            "lapTimeLossSeconds": 0.802391301,
            "points": [
              {
                "eta": 0,
                "index": 2022
              },
              {
                "eta": 2.701434343,
                "index": 2042
              },
              {
                "eta": 3.170057097,
                "index": 2048
              },
              {
                "eta": 1.862761937,
                "index": 2080
              },
              {
                "eta": 2.350348447,
                "index": 2115
              },
              {
                "eta": 0,
                "index": 2133
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 55.6175684,
            "brakeI": 2080,
            "cornerTimeSeconds": 4.272693629,
            "kind": "inside",
            "lapTimeLossSeconds": 0.102536661,
            "points": [
              {
                "eta": 2.194548194,
                "index": 2022
              },
              {
                "eta": 2.194548194,
                "index": 2048
              },
              {
                "eta": 2.194548194,
                "index": 2080
              },
              {
                "eta": 2.194548194,
                "index": 2133
              }
            ],
            "terminal": "sustained-offset"
          }
        },
        "outside": {
          "idealRejoin": {
            "apexSpeed": 55.667898845,
            "brakeI": 2076,
            "cornerTimeSeconds": 4.396981003,
            "kind": "outside",
            "lapTimeLossSeconds": 0.475195955,
            "points": [
              {
                "eta": 0,
                "index": 2022
              },
              {
                "eta": -0.771806229,
                "index": 2042
              },
              {
                "eta": -1.038941586,
                "index": 2048
              },
              {
                "eta": -2.341638478,
                "index": 2080
              },
              {
                "eta": 2.350348447,
                "index": 2115
              },
              {
                "eta": 0,
                "index": 2133
              }
            ],
            "terminal": "ideal-rejoin"
          },
          "sustainedOffset": {
            "apexSpeed": 56.995691066,
            "brakeI": 2080,
            "cornerTimeSeconds": 4.28185385,
            "kind": "outside",
            "lapTimeLossSeconds": 0.172746509,
            "points": [
              {
                "eta": -2.984188427745507,
                "index": 2022
              },
              {
                "eta": -2.984188427745507,
                "index": 2048
              },
              {
                "eta": -2.984188428,
                "index": 2080
              },
              {
                "eta": -2.984188427745507,
                "index": 2133
              }
            ],
            "terminal": "sustained-offset"
          }
        }
      }
    ],
    "metrics": {
      "estimatedLapTime": 85.219223261,
      "maximumTrackingError": 0.768753493,
      "offCourseSeconds": 0,
      "robustnessScore": 1,
      "verifiedLapTime": 96.641666667
    },
    "optimizerVersion": "bounded-surface-pattern-search-2",
    "physicsFingerprint": "fnv1a32:beeb29cc",
    "provenance": {
      "budgetSeconds": 600,
      "evaluations": 860,
      "search": "deterministic-coordinate-pattern+seeded-restarts+successive-halving",
      "seed": 131
    },
    "schemaVersion": 1,
    "status": "acceptable",
    "surfaceFingerprint": "fnv1a32:11738317",
    "trackFingerprint": "fnv1a32:59efbb2a",
    "trackId": "paulista"
  }
] as const satisfies readonly TrackProfile[];
