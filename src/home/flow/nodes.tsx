import type { CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Avatar, CompanyLogo } from '../components';
import {
  handleStyle,
  LOGO,
  NODE_HEIGHT,
  NODE_WIDTH,
  ORB,
  ORB_INSET,
  PERSON_NODE_WIDTH,
  PERSON_ORB,
} from './dimensions';

/** The React Flow data payload carried by each company node. */
export type CompanyNodeData = {
  name: string;
  logoDataUrl?: string;
  tenure: string;
  color?: string; // dominant logo colour, for the corona treatment
  index: number; // chain order, for staggering float/glint animations
  faded?: boolean; // sibling fading out during a drill-in (m2 fly-in)
  focus?: boolean; // the focused company in a galaxy (name shown in full)
};

export type PersonNodeData = {
  name: string;
  photoDataUrl?: string;
  index: number;
};

/**
 * Custom Level-0 company node (m1-plan §7): a round company "star" (the logo as
 * a real coin) with the company name below and tenure demoted to a faint line.
 * In the atlas it is the clickable, expandable tier; in a galaxy the same
 * component renders the focused company pinned at the top.
 *
 * The visible star + label live in a `.career-node__pop` wrapper so the intro
 * "ignition" scale never touches the edge handles. Handles carry edges and are
 * invisible; they get explicit ids so the chain (left/right) and the galaxy
 * spokes (bottom to top) never pick the wrong anchor.
 */
function CompanyNode({ data }: NodeProps<Node<CompanyNodeData>>) {
  const style = {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    '--star-color': data.color ?? 'rgba(140, 158, 235, 0.9)',
    '--i': data.index,
  } as CSSProperties;
  const className =
    'career-node' +
    (data.faded ? ' career-node--faded' : '') +
    (data.focus ? ' career-node--focus' : '');
  return (
    <div className={className} style={style}>
      <Handle
        id="l"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ ...handleStyle, left: ORB_INSET }}
      />
      <div className="career-node__pop">
        <div className="career-star" style={{ width: ORB, height: ORB }}>
          <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={LOGO} />
        </div>
        <div className="career-node__label">
          <span className="career-node__name" title={data.name}>
            {data.name}
          </span>
          <span className="career-node__tenure">{data.tenure}</span>
        </div>
      </div>
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ ...handleStyle, right: ORB_INSET }}
      />
    </div>
  );
}

/**
 * A raw Level 1 person (m2-plan §6): a small star with the connection's photo.
 * The name is hidden and floats in on hover, so the row packs tight. Styled as
 * unverified; M3 introduces the verified/pruned visual language. The `--i` var
 * staggers the galaxy reveal.
 */
function PersonNode({ data }: NodeProps<Node<PersonNodeData>>) {
  const style = {
    width: PERSON_NODE_WIDTH,
    '--i': data.index,
  } as CSSProperties;
  return (
    <div className="person-node" style={style}>
      <div className="person-node__pop">
        <div
          className="person-star"
          style={{ width: PERSON_ORB, height: PERSON_ORB }}
        >
          <Avatar dataUrl={data.photoDataUrl} name={data.name} size={PERSON_ORB} />
        </div>
        {/* Name floats below the orb on hover only (see styles.css). */}
        <span className="person-node__name">{data.name}</span>
      </div>
    </div>
  );
}

export type GalaxyTitleData = { companyName?: string };

/** The galaxy heading, placed in world space between the focused star and the
 *  people row so it stays "between the logo and the faces" as the camera moves
 *  (m2). Non-interactive: clicks pass through to the canvas. */
function GalaxyTitleNode({ data }: NodeProps<Node<GalaxyTitleData>>) {
  return (
    <div className="galaxy-title">
      <h2 className="galaxy-title__head">People you probably know</h2>
      <p className="galaxy-title__sub">
        Tap a face to follow their path after {data.companyName ?? 'here'}.
      </p>
    </div>
  );
}

/** A zero-size, invisible node used only to extend the galaxy's bounds (it
 *  reserves empty room below the people row so fitView frames the composition
 *  high, leaving space for M4 trajectories). */
function SpacerNode() {
  return <div className="galaxy-spacer" aria-hidden="true" />;
}

export const nodeTypes = {
  company: CompanyNode,
  person: PersonNode,
  galaxyTitle: GalaxyTitleNode,
  spacer: SpacerNode,
};
