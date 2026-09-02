// Fixed node dimensions shared across the flow pieces. React Flow's fitView
// needs stable measurements to frame the graph correctly (m1-plan §11); keep
// these in sync with the .career-node / .person-node CSS in styles.css.
export const ORB = 84; // diameter of the company orb
export const LOGO = 80; // the logo nearly fills the orb; only a thin rim frames it
export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 138; // orb + label stack
export const ORB_INSET = (NODE_WIDTH - ORB) / 2; // align edge handles to the orb rim
// Edges attach at the orb's vertical center and horizontal rim, so the chain
// runs orb-to-orb rather than from the (taller) node bounding box.
export const handleStyle = { top: ORB / 2 } as const;

// The person orb: smaller than a company, with the photo as its image. The node is
// just the orb (name floats in on hover), so hover targeting is precise and the
// row can pack tight.
export const PERSON_ORB = 60;
export const PERSON_NODE_WIDTH = PERSON_ORB;

// Onward "leaf" (M3): a Level-2 company a colleague joined next. The company
// logo as its image, with an always-on label (name + join year) below it. Never
// expandable. The node box stays the orb width; the label is centered over it
// (absolutely positioned), like the person name chip.
export const ONWARD_ORB = 56;
export const ONWARD_NODE_WIDTH = ONWARD_ORB;

// A promotion marker (issue #14): a rank pip threaded on a terminal lane's
// beam, one per earlier title held at the current company. Grows a little
// with each step (oldest title smallest) so moving up the beam reads as
// levelling up; ROLE_BEAD_MAX keeps the last one still clearly smaller than
// the destination orb it leads into.
export const ROLE_BEAD_MIN = 20;
export const ROLE_BEAD_STEP = 6;
export const ROLE_BEAD_MAX = ONWARD_ORB - 12;
