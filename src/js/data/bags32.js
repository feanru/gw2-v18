const createDefaultVariant = (manualIngredients) => ({
  id: "default",
  name: "Receta estándar",
  manualIngredients,
});

const createPactVariant = (id, name, manualIngredients) => ({
  id,
  name,
  manualIngredients: [
    {
      id: 82888,
      name: "Talega de mariscal de 28 casillas",
      count: 1,
      manualIngredients: [
        {
          id: 84557,
          name: "Talega de mariscal de 24 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 74525,
              name: "Caja de equipamiento de 20 casillas del Pacto",
              count: 2,
              manualIngredients,
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 1 },
            { id: 82678, name: "Chispa marcada palpitante", count: 1 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 5 },
        { id: 82678, name: "Chispa marcada palpitante", count: 1 },
      ],
    },
    { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
    { id: 83410, name: "Runa suprema de sujeción", count: 12 },
    { id: 82678, name: "Chispa marcada palpitante", count: 1 },
  ],
});

const createPactWardrobeVariant = (id, name, manualIngredients) => ({
  id,
  name,
  manualIngredients: [
    {
      id: 83737,
      name: "Armario de mariscal de 28 casillas",
      count: 1,
      manualIngredients: [
        {
          id: 83218,
          name: "Armario de mariscal de 24 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 74525,
              name: "Caja de equipamiento de 20 casillas del Pacto",
              count: 2,
              manualIngredients,
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 1 },
            { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 5 },
        { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
      ],
    },
    { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
    { id: 83410, name: "Runa suprema de sujeción", count: 12 },
    { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
  ],
});

const createPactSaddlebagVariant = (id, name, manualIngredients) => ({
  id,
  name,
  manualIngredients: [
    {
      id: 84544,
      name: "Alforja de mariscal de 28 casillas",
      count: 1,
      manualIngredients: [
        {
          id: 82237,
          name: "Alforja de mariscal de 24 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 74525,
              name: "Caja de equipamiento de 20 casillas del Pacto",
              count: 2,
              manualIngredients,
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 1 },
            { id: 83757, name: "Putrefacción coagulada", count: 100 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 5 },
        { id: 83757, name: "Putrefacción coagulada", count: 100 },
      ],
    },
    { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
    { id: 83410, name: "Runa suprema de sujeción", count: 12 },
    { id: 83757, name: "Putrefacción coagulada", count: 100 },
  ],
});

export const bags32 = [
  {
    id: 83995,
    name: "Alforja de gasa de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 83436,
          name: "Alforja de gasa de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 84420,
              name: "Alforja de gasa de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9571,
                  name: "Saco de gasa de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19746, name: "Haz de gasa", count: 10 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 83757, name: "Putrefacción coagulada", count: 100 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 83757, name: "Putrefacción coagulada", count: 100 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 83757, name: "Putrefacción coagulada", count: 100 },
      ]),
    ],
  },
  {
    id: 85370,
    name: "Talega de mensajero de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 83092,
          name: "Talega de mensajero de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 82901,
              name: "Talega de mensajero de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9584,
                  name: "Bolsa invisible de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19737, name: "Retal de cuero curado endurecido", count: 22 },
                    { id: 24277, name: "Montón de polvo cristalino", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 83757, name: "Putrefacción coagulada", count: 100 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 83757, name: "Putrefacción coagulada", count: 100 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 83757, name: "Putrefacción coagulada", count: 100 },
      ]),
    ],
  },
  {
    id: 85372,
    name: "Talega de mariscal de 32 casillas",
    variants: [
      createPactVariant(
        "pacto-lingotes-retales",
        "Caja del Pacto: lingotes de oricalco + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19685, name: "Lingote de oricalco", count: 10 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactVariant(
        "pacto-tela-polvo-retales",
        "Caja del Pacto: haz de gasa + polvo cristalino + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19746, name: "Haz de gasa", count: 10 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactVariant(
        "pacto-polvo-retales",
        "Caja del Pacto: polvo cristalino + 22 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 22 },
        ],
      ),
    ],
  },
  {
    id: 83109,
    name: "Talega de hamaseen de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 84686,
          name: "Talega de hamaseen de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 83933,
              name: "Talega de hamaseen de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9585,
                  name: "Bolsa engrasada de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19737, name: "Retal de cuero curado endurecido", count: 10 },
                    { id: 24358, name: "Hueso antiguo", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 82678, name: "Chispa marcada palpitante", count: 1 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 82678, name: "Chispa marcada palpitante", count: 1 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 82678, name: "Chispa marcada palpitante", count: 1 },
      ]),
    ],
  },
  {
    id: 83182,
    name: "Talega de cuero endurecido de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 83897,
          name: "Talega de cuero endurecido de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 82511,
              name: "Talega de cuero endurecido de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9581,
                  name: "Bolsa de cuero endurecido de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19737, name: "Retal de cuero curado endurecido", count: 10 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 82678, name: "Chispa marcada palpitante", count: 1 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 82678, name: "Chispa marcada palpitante", count: 1 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 82678, name: "Chispa marcada palpitante", count: 1 },
      ]),
    ],
  },
  {
    id: 85371,
    name: "Armario de oricalco de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 83021,
          name: "Armario de oricalco de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 83155,
              name: "Armario de oricalco de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9591,
                  name: "Caja de oricalco de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19685, name: "Lingote de oricalco", count: 10 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
      ]),
    ],
  },
  {
    id: 83286,
    name: "Armario de nómada de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 84037,
          name: "Armario de nómada de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 84515,
              name: "Armario de nómada de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9593,
                  name: "Caja de equipamiento de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19685, name: "Lingote de oricalco", count: 10 },
                    { id: 24289, name: "Escama blindada", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
      ]),
    ],
  },
  {
    id: 82277,
    name: "Armario de mensajero de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 84271,
          name: "Armario de mensajero de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 83415,
              name: "Armario de mensajero de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9594,
                  name: "Caja fuerte de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19685, name: "Lingote de oricalco", count: 10 },
                    { id: 24277, name: "Montón de polvo cristalino", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 82582, name: "Triza de forjametal tembloroso", count: 10 },
      ]),
    ],
  },
  {
    id: 83205,
    name: "Armario de mariscal de 32 casillas",
    variants: [
      createPactWardrobeVariant(
        "pacto-lingotes-retales",
        "Caja del Pacto: lingotes de oricalco + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19685, name: "Lingote de oricalco", count: 10 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactWardrobeVariant(
        "pacto-tela-polvo-retales",
        "Caja del Pacto: haz de gasa + polvo cristalino + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19746, name: "Haz de gasa", count: 10 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactWardrobeVariant(
        "pacto-polvo-retales",
        "Caja del Pacto: polvo cristalino + 22 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 22 },
        ],
      ),
    ],
  },
  {
    id: 83186,
    name: "Armario de Liga Cauri de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 84163,
          name: "Armario de Liga Cauri de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 83887,
              name: "Armario de Liga Cauri de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9572,
                  name: "Saco de artesano de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19746, name: "Haz de gasa", count: 10 },
                    { id: 24358, name: "Hueso antiguo", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 83757, name: "Putrefacción coagulada", count: 100 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 83757, name: "Putrefacción coagulada", count: 100 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 83757, name: "Putrefacción coagulada", count: 100 },
      ]),
    ],
  },
  {
    id: 83435,
    name: "Alforja de mensajero de 32 casillas",
    variants: [
      createDefaultVariant([
        {
          id: 83130,
          name: "Alforja de mensajero de 28 casillas",
          count: 1,
          manualIngredients: [
            {
              id: 83297,
              name: "Alforja de mensajero de 24 casillas",
              count: 1,
              manualIngredients: [
                {
                  id: 9574,
                  name: "Saco invisible de 20 casillas",
                  count: 2,
                  manualIngredients: [
                    { id: 13009, name: "Runa superior de sujeción", count: 1 },
                    { id: 19746, name: "Haz de gasa", count: 10 },
                    { id: 24277, name: "Montón de polvo cristalino", count: 3 },
                  ],
                },
                { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
                { id: 83410, name: "Runa suprema de sujeción", count: 1 },
                { id: 83757, name: "Putrefacción coagulada", count: 100 },
              ],
            },
            { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
            { id: 83410, name: "Runa suprema de sujeción", count: 5 },
            { id: 83757, name: "Putrefacción coagulada", count: 100 },
          ],
        },
        { id: 83322, name: "Carrete de hilo de Deldrimor", count: 4 },
        { id: 83410, name: "Runa suprema de sujeción", count: 12 },
        { id: 83757, name: "Putrefacción coagulada", count: 100 },
      ]),
    ],
  },
  {
    id: 83435,
    name: "Alforja de mariscal de 32 casillas",
    variants: [
      createPactSaddlebagVariant(
        "pacto-lingotes-retales",
        "Caja del Pacto: lingotes de oricalco + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19685, name: "Lingote de oricalco", count: 10 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactSaddlebagVariant(
        "pacto-tela-polvo-retales",
        "Caja del Pacto: haz de gasa + polvo cristalino + 12 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 19746, name: "Haz de gasa", count: 10 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 12 },
        ],
      ),
      createPactSaddlebagVariant(
        "pacto-polvo-retales",
        "Caja del Pacto: polvo cristalino + 22 retales",
        [
          { id: 13009, name: "Runa superior de sujeción", count: 1 },
          { id: 24277, name: "Montón de polvo cristalino", count: 3 },
          { id: 19737, name: "Retal de cuero curado endurecido", count: 22 },
        ],
      ),
    ],
  },
];

export default bags32;
