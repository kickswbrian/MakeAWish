import { colorName, describeSpec } from "./guess.ts";
import type { ProductSpec } from "./spec.ts";

/**
 * Offline answers to the questions judges ask the genie mid-demo. The Claude brain answers these
 * itself from the facts in its prompt; this keeps the rule brain from answering a question with
 * "What color are you dreaming of?". Facts here must match README.md and docs/build-plan.md.
 */

/** Looks like a question rather than an edit. */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\?\s*$/.test(t)
    || /^(?:(?:so|ok|okay|wait|and|but|hey|um|uh|genie|quick question)[, ]+)*(how|what|why|when|where|who|whose|which|can|could|does|do|did|is|are|will|would|should|if|tell me|explain)\b/.test(t)
    || /\b(i'?m curious|i wonder|wondering|question for you)\b/.test(t);
}

interface Topic { re: RegExp; answer: (spec: ProductSpec) => string }

const TOPICS: Topic[] = [
  {
    // Who built you comes before "how does this work" so "who made you" isn't about manufacturing.
    re: /\b(who (?:built|made|created|designed) (?:you|this app|this|the app|wish it)|what model|what ai|which ai|are you (?:an? )?(?:ai|bot|robot|claude|chatgpt|human)|what powers you)\b/,
    answer: () => "A team at Cal Hacks 13 built me, and Claude is the brain that turns what you say into the design.",
  },
  {
    re: /\b(test card|which card|what card|card number|card should i use|card do i use|try (?:it|pledging|a pledge)|pledge from my phone|how do i (?:pledge|back))\b/,
    answer: () => "Scan the QR code and use the test card 4242 4242 4242 4242 with any future date and CVC; 4000 0000 0000 0002 shows what a declined card looks like. Nothing real is charged.",
  },
  {
    re: /\b(how many (?:backers|people|pledges)|backers (?:does it|do you) need|what'?s the goal|the target|goal is)\b/,
    answer: () => "You choose the goal when you launch the campaign, say five backers. When that many holds are in, every hold is captured and it goes to a maker.",
  },
  {
    re: /\b(charge|charged|charges|pay|paying|payment|payments|credit card|my card|the card|card holds?|holds? on (?:my|the) card|hold works|holds work|what'?s a hold|what is a hold|why (?:use )?(?:a )?holds?|money|refund|refunded|cost me|billed|bill me|stripe|visa)\b/,
    answer: () => "Backing a wish only places a hold on your card, it isn't a charge. If enough people commit before the deadline every hold is captured; if not, every hold is released and nobody pays.",
  },
  {
    re: /\b(deadline|how long (?:does|do|will|is|are) (?:the |a |my |this )?(?:campaign|campaigns|it run|it last|it stay open|funding|the wish stay)|how long do (?:i|people|backers) have|how many days (?:do|does|will|is|are) (?:i|we|people|backers|it|the campaign|a campaign)|expire|expires|expiry|time limit|when does it end|what (?:if|happens if) (?:nobody|no one|not enough)|not enough (?:people|backers)|doesn'?t (?:get|reach|hit))\b/,
    answer: () => "Campaigns last at most six days, inside the window a card hold can stay open. If the goal isn't reached by then, every hold is released and nobody is charged.",
  },
  {
    re: /\b(already exist|exists|exist already|out there|for sale|on amazon|amazon|etsy|google shopping|search|apify|find it|buy it|someone (?:already )?(?:made|sells))\b/,
    answer: () => "When you lock it in, I search Amazon and Google Shopping and score every listing against your design. If something close is out there, I show you where to buy it.",
  },
  {
    re: /\b(who makes|who will make|who'?d make|manufactur\w*|factory|maker|makers|produce|produced|production|build it|built for real|actually made)\b/,
    answer: () => "When a campaign is funded, a purchase order with your spec and 3D model goes to a maker. In this demo the maker is simulated, and the card holds are test-mode payments, so no real money moves.",
  },
  {
    re: /\b(ship|shipping|deliver|delivery|arrive|when (?:do|will) i get)\b/,
    answer: () => "Shipping and delivery come from the maker once a campaign is funded. In this demo the maker is simulated, so there's nothing to ship yet.",
  },
  {
    re: /\b(3d|three d|model|render|rendering|how do you (?:draw|make|build) (?:it|this|that)|meshy|mesh|graphics|how is (?:this|it) (?:drawn|made|rendered))\b/,
    answer: () => "The model you see is built instantly from your design as you talk. When you lock it in, an AI 3D model of your exact wish is generated in the background.",
  },
  {
    re: /\b(privacy|private|data|email|account|sign up|signup|log ?in|personal info)\b/,
    answer: () => "There are no accounts: backers give an email and a card, and the card goes straight to the payment provider. Your wish is public only if you launch it as a campaign.",
  },
  {
    re: /\b(price|cost|how much|expensive|cheap|afford)\b/,
    answer: (s) => s.target_price_usd
      ? `You said you'd pay about $${s.target_price_usd}, so that's the campaign price. Backers only pay it if the wish gets made.`
      : "You set the price: tell me what you'd happily pay, and that's what backers pledge. Nobody pays unless it gets made.",
  },
  {
    re: /\b(made of|material|materials|fabric|what is it|what'?s it|describe|what does it look like|what have we got|what do we have|what'?s on it|what did (?:we|you) (?:make|add))\b/,
    answer: (s) => {
      if (s.category === "generic" && !s.name && !s.body) return "Nothing yet! Describe any product you wish existed and I'll start shaping it.";
      const extras = [
        ...(s.decals ?? []).map((d) => `${d.kind === "text" ? `"${d.content}"` : d.kind === "shape" ? `a ${d.content.replace(/_/g, " ")}` : d.content} on the ${d.placement}`),
        ...(s.addons ?? []).map((a) => `${a.count && a.count > 1 ? `${a.count} ` : "a "}${a.name}`),
      ];
      const look = describeSpec(s).replace(/\bwish\b/, s.name ?? "wish");
      return `Right now it's a ${look}${s.fabric && s.category !== "dress" && s.category !== "top" && s.category !== "skirt" ? ` in ${s.fabric}` : ""}${extras.length ? `, with ${extras.slice(0, 3).join(", ")}` : ""}. Want to change anything?`;
    },
  },
  {
    re: /\b(who are you|what are you|what can you do|how does (?:this|it|wish it) work|what is (?:this|wish it)|what'?s (?:this|wish it)|explain (?:this|it)|what do you do|help)\b/,
    answer: () => "I'm the Wish it genie: describe any product, I shape it in 3D as you talk, check whether it already exists, and turn it into a campaign people back with card holds.",
  },
  {
    re: /\b(favou?rite colou?r)\b/,
    answer: (s) => `Emerald, the color of a wish about to come true${s.color ? `, though your ${colorName(s.color)} is a strong choice` : ""}.`,
  },
  {
    re: /\b(can (?:it|you|i)|could (?:it|you)|is it possible|are you able)\b/,
    answer: () => "Probably! Say exactly what you'd like changed or added and I'll shape it right away.",
  },
];

/** An answer when the utterance is a question this genie knows about, else null. */
export function answerQuestion(text: string, spec: ProductSpec): string | null {
  if (!isQuestion(text)) return null;
  const t = " " + text.toLowerCase().replace(/[^a-z0-9$' ]+/g, " ").replace(/\s+/g, " ") + " ";
  for (const topic of TOPICS) if (topic.re.test(t)) return topic.answer(spec);
  return "Good question! I can't answer that one, but I can change anything about your design.";
}
