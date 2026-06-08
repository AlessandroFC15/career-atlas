import { useState, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Avatar, CompanyLogo, Spinner } from '../components';
import {
  handleStyle,
  LOGO,
  NODE_HEIGHT,
  NODE_WIDTH,
  ONWARD_NODE_WIDTH,
  ONWARD_ORB,
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
  // M3: trace state. 'raw' = candidate (clickable), 'expanded' = settled into a
  // lane (the face), 'dismissed' = false positive (dimmed, hover hint).
  status?: 'raw' | 'expanded' | 'dismissed';
  expanding?: boolean; // a trace is in flight: spinner over the orb
  companyName?: string; // for the dismissed hint ("didn't work at <company>")
  terminal?: boolean; // expanded but no onward: a quiet "still at <company>"
};

export type OnwardNodeData = {
  name: string;
  logoDataUrl?: string;
  index: number; // for the staggered reveal along the lane
  convergent?: boolean; // shared destination across ≥2 lanes: accent glow
  year?: string; // the join year (when they moved there), shown under the name
  color?: string; // dominant brand colour, tints the corona to match its beam
  roles?: string[]; // the colleague's role title(s) there, revealed on hover
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
        {/* The hover lift + post-seed ripple ride on this wrapper, not on
            .career-star (which runs the infinite starfloat) nor .career-node
            (which carries the edge handles), so the transforms compose and the
            beams stay pinned to the orb center (143ece1). See styles.css §M2. */}
        <div className="career-star-wrap">
          <div className="career-star" style={{ width: ORB, height: ORB }}>
            <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={LOGO} />
          </div>
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
  const status = data.status ?? 'raw';
  const style = {
    width: PERSON_NODE_WIDTH,
    '--i': data.index,
  } as CSSProperties;
  return (
    <div className="person-node" data-status={status} style={style}>
      {/* A right-edge source handle so an expanded face can beam to its first
          onward leaf. Invisible (styled tiny); the cluster orbs never use it. */}
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ top: PERSON_ORB / 2 }}
      />
      <div className="person-node__pop">
        <div
          className="person-star"
          style={{ width: PERSON_ORB, height: PERSON_ORB }}
        >
          <Avatar dataUrl={data.photoDataUrl} name={data.name} size={PERSON_ORB} />
          {data.expanding && (
            <div className="person-star__spinner">
              <Spinner />
            </div>
          )}
        </div>
        {/* Name floats below the orb on hover only (see styles.css). A dismissed
            orb instead reveals the false-positive hint. */}
        <span className="person-node__name">
          {status === 'dismissed'
            ? `didn't work at ${data.companyName ?? 'here'}`
            : data.name}
        </span>
        {/* A traced colleague with no onward path: a quiet always-on caption so
            the lone face reads as intentional, not broken. */}
        {status === 'expanded' && data.terminal && (
          <span className="person-node__caption">
            still at {data.companyName ?? 'here'}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A Level-2 onward "leaf" (m3-plan §6e): a small star with the company logo as
 * the coin, sitting on a colleague's lane at its join date. Never expandable
 * (no click handler). Companies reached by ≥2 colleagues carry a convergence
 * accent. Name floats in on hover, like the person orbs.
 */
function OnwardNode({ data }: NodeProps<Node<OnwardNodeData>>) {
  const style = {
    width: ONWARD_NODE_WIDTH,
    '--i': data.index,
    // Monochrome logos (black/white) sample to no hue; fall back to a muted,
    // low-luminance cool grey so they read as a quiet neutral star and recede
    // next to the saturated brands, instead of a bright white beacon on black.
    '--leaf-color': data.color ?? 'rgb(150, 160, 182)',
  } as CSSProperties;
  const className = 'onward-node' + (data.convergent ? ' onward-node--converge' : '');
  const hStyle = { top: ONWARD_ORB / 2 } as const;
  return (
    <div className={className} style={style}>
      {/* l/r carry the lane beam (face → leaf → leaf); t/b carry the vertical
          convergence threads between lanes. All invisible (styled tiny). */}
      <Handle id="l" type="target" position={Position.Left} isConnectable={false} style={hStyle} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} style={hStyle} />
      <Handle id="t" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="b" type="source" position={Position.Bottom} isConnectable={false} />
      <div className="onward-node__pop">
        {/* Role title(s) the colleague held there, revealed above the orb on
            hover (latest first, as parsed). */}
        {data.roles && data.roles.length > 0 && (
          <span className="onward-node__title">{data.roles.join(' · ')}</span>
        )}
        <div
          className="onward-star"
          style={{ width: ONWARD_ORB, height: ONWARD_ORB }}
        >
          <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={ONWARD_ORB} />
        </div>
        {/* Always-on label: the company they moved to, and the year it happened. */}
        <div className="onward-node__label">
          <span className="onward-node__name" title={data.name}>
            {data.name}
          </span>
          {data.year && <span className="onward-node__year">{data.year}</span>}
        </div>
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

/** The shared "today" line (M3): a faint vertical marker at the right edge of
 *  the time axis, spanning the lanes. The present-tails (current jobs) reach it,
 *  so "still there" reads as a line that arrives at today. Non-interactive. */
function NowLineNode({ data }: NodeProps<Node<{ height: number }>>) {
  return (
    <div className="now-line" style={{ height: data.height }}>
      <span className="now-line__label">now</span>
    </div>
  );
}

/** A zero-size invisible target on the now-line, so a present-tail beam can end
 *  exactly on it (its left handle sits at today). */
function NowAnchorNode() {
  return (
    <div className="now-anchor" aria-hidden="true">
      <Handle id="l" type="target" position={Position.Left} isConnectable={false} />
    </div>
  );
}

/**
 * The "show more people" affordance, as the next star in the row: a small glassy
 * orb (a dashed outline holding an ellipsis of three tiny star-dots) sitting just
 * past the last face, so "more here" lives where the eye already is. Click loads
 * the next page; while it
 * loads the orb shows a spinner in place. There is no count (the search pages
 * until a load returns empty), so the orb just says "more", not a number.
 */
function LoadMoreNode() {
  const [loading, setLoading] = useState(false);
  const onClick = () => {
    if (loading) return;
    setLoading(true);
    // No pagination backend yet: spin briefly, then settle, rather than
    // fabricating people. Wire the real paginated fetch here, clearing `loading`
    // when the page arrives (and removing this orb when a page comes back empty).
    setTimeout(() => setLoading(false), 1500);
  };
  return (
    <div
      className="loadmore-node"
      style={{ width: PERSON_NODE_WIDTH } as CSSProperties}
      onClick={onClick}
      title="Show more people"
    >
      <div
        className="loadmore-star"
        style={{ width: PERSON_ORB, height: PERSON_ORB }}
      >
        {loading ? (
          <Spinner />
        ) : (
          // An ellipsis rendered as three tiny stars: "more", quiet and at home
          // in the sky rather than looking like a text control.
          <span className="loadmore-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <span className="loadmore-node__label">more</span>
    </div>
  );
}

export const nodeTypes = {
  company: CompanyNode,
  person: PersonNode,
  onward: OnwardNode,
  galaxyTitle: GalaxyTitleNode,
  spacer: SpacerNode,
  nowLine: NowLineNode,
  nowAnchor: NowAnchorNode,
  loadMore: LoadMoreNode,
};
