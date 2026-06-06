// Fixed node dimensions shared across the flow pieces. React Flow's fitView
// needs stable measurements to frame the graph correctly (m1-plan §11); keep
// these in sync with the .career-node / .person-node CSS in styles.css.
export const ORB = 84; // diameter of the company "star"
export const LOGO = 80; // the logo nearly fills the orb; only a thin rim frames it
export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 138; // orb + label stack
export const ORB_INSET = (NODE_WIDTH - ORB) / 2; // align edge handles to the orb rim
// Edges attach at the orb's vertical center and horizontal rim, so the chain
// runs star-to-star rather than from the (taller) node bounding box.
export const handleStyle = { top: ORB / 2 } as const;

// Person "star": a smaller orb than a company, photo as the coin. The node is
// just the orb (name floats in on hover), so hover targeting is precise and the
// row can pack tight.
export const PERSON_ORB = 60;
export const PERSON_NODE_WIDTH = PERSON_ORB;
