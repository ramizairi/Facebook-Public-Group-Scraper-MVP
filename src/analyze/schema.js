import { z } from "zod";

export const AnalysisRowSchema = z.object({
  index: z.number().int().nonnegative().describe("Index of the source post inside the current batch."),
  gender: z.enum(["male", "female", "unknown"]).describe("Gender inferred from the profile name only when reasonably likely."),
  status: z.enum(["offer", "request", "unknown"]).describe("Whether the post is offering a ride, requesting a ride, or unclear."),
  from_city: z.string().nullable().describe("Departure city in Tunisia when inferable. Null when unclear."),
  from_area: z.string().nullable().describe("More specific departure area or neighborhood. Null when unclear."),
  to_area: z.string().nullable().describe("Destination area or city phrase. Null when unclear."),
  preferred_departure_time: z
    .string()
    .nullable()
    .describe("Preferred departure time normalized when possible, for example 06:30, 15:00, morning, afternoon, evening."),
  price: z.number().nullable().describe("Price in Tunisian dinars when explicitly stated. Null if not explicit."),
  nb_passengers: z.number().int().nullable().describe("Number of passengers or seats requested/offered when explicit."),
});

export const AnalysisBatchSchema = z.object({
  items: z.array(AnalysisRowSchema),
});

export const analysisResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: {
            type: "integer",
            description: "Index of the source post inside the current batch.",
          },
          gender: {
            type: "string",
            enum: ["male", "female", "unknown"],
            description: "Gender inferred from the profile name only when reasonably likely.",
          },
          status: {
            type: "string",
            enum: ["offer", "request", "unknown"],
            description: "Whether the post is offering a ride, requesting a ride, or unclear.",
          },
          from_city: {
            type: ["string", "null"],
            description: "Departure city in Tunisia when inferable. Null when unclear.",
          },
          from_area: {
            type: ["string", "null"],
            description: "More specific departure area or neighborhood. Null when unclear.",
          },
          to_area: {
            type: ["string", "null"],
            description: "Destination area or city phrase. Null when unclear.",
          },
          preferred_departure_time: {
            type: ["string", "null"],
            description: "Preferred departure time normalized when possible.",
          },
          price: {
            type: ["number", "null"],
            description: "Price in Tunisian dinars when explicitly stated.",
          },
          nb_passengers: {
            type: ["integer", "null"],
            description: "Number of passengers or seats requested/offered when explicit.",
          },
        },
        required: [
          "index",
          "gender",
          "status",
          "from_city",
          "from_area",
          "to_area",
          "preferred_departure_time",
          "price",
          "nb_passengers",
        ],
      },
    },
  },
  required: ["items"],
};
