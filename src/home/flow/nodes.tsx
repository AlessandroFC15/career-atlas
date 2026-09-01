import { useEffect, useState, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Avatar, CompanyLogo, Spinner } from '../components';
import { t } from '../../i18n';
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
  // M3: trace state. 'raw' = candidate (clickable), 'traced' = settled into a
  // lane (the face), 'dismissed' = false positive (dimmed, hover hint).
  status?: 'raw' | 'traced' | 'dismissed';
  tracing?: boolean; // a trace is in flight: spinner over the orb
  companyName?: string; // for the dismissed hint ("didn't work at <company>")
  terminal?: boolean; // traced but no onward: a quiet "still at <company>"
  // The colleague's LinkedIn profile, on lane faces only: a traced face has no
  // click of its own left (trace already happened), so the orb becomes the link.
  profileUrl?: string;
  // Arrived on the batch a "more" click just paged in, rather than on entering
  // the galaxy. Reveals without the camera-fly gate and at a quicker stagger:
  // there is no long camera move to wait out on an append. Read once, at mount.
  fresh?: boolean;
};

export type OnwardNodeData = {
  name: string;
  logoDataUrl?: string;
  index: number; // for the staggered reveal along the lane
  convergent?: boolean; // shared destination across ≥2 lanes: accent glow
  year?: string; // the join year (when they moved there), shown under the name
  color?: string; // dominant brand colour, tints the corona to match its beam
  roles?: string[]; // the colleague's role title(s) there, revealed on hover
  companyUrl?: string; // LinkedIn page; an "open" badge on hover
};

/**
 * Custom Level-0 company node (m1-plan §7): a round company orb (the logo as a
 * real disc of light) with the company name below and tenure demoted to a faint line.
 * In the atlas it is the clickable, expandable tier; in a galaxy the same
 * component renders the focused company pinned at the top.
 *
 * The visible orb + label live in a `.career-node__pop` wrapper so the intro
 * "ignition" scale never touches the edge handles. Handles carry edges and are
 * invisible; they get explicit ids so the chain (left/right) and the galaxy
 * spokes (bottom to top) never pick the wrong anchor.
 */
function CompanyNode({ data }: NodeProps<Node<CompanyNodeData>>) {
  const style = {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    '--orb-color': data.color ?? 'rgba(140, 158, 235, 0.9)',
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
            .career-orb (which runs the infinite orbfloat) nor .career-node
            (which carries the edge handles), so the transforms compose and the
            beams stay pinned to the orb center (143ece1). See styles.css §M2. */}
        <div className="career-orb-wrap">
          <div className="career-orb" style={{ width: ORB, height: ORB }}>
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

// Flavour captions cycled under an orb while its trace runs. Not tied to real
// phases (the trace is fast now); they just keep the wait feeling alive.
const TRACE_MESSAGE_KEYS = [
  'traceMessageOpeningProfile',
  'traceMessageReadingHistory',
  'traceMessageTracing',
  'traceMessageCharting',
];

/** Cycle through the trace captions on a timer while `active`; resets when idle. */
function useTraceMessage(active: boolean): string | null {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    const id = setInterval(() => setI((n) => (n + 1) % TRACE_MESSAGE_KEYS.length), 1700);
    return () => clearInterval(id);
  }, [active]);
  return active ? t(TRACE_MESSAGE_KEYS[i]) : null;
}

/**
 * The "opens elsewhere" corner mark shared by the orbs that are links (an onward
 * leaf, a traced lane face). It renders inside the anchor, so the disc is part of
 * the same link: the arrow you can see is the arrow you can click, including the
 * part of it that overhangs the orb.
 */
function OrbOpenMark() {
  return (
    <span className="orb-open" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 16 L16 8" />
        <path d="M9.5 8 H16 V14.5" />
      </svg>
    </span>
  );
}

/**
 * A raw Level 1 person (m2-plan §6): a small orb with the connection's photo.
 * The name is hidden and floats in on hover, so the row packs tight. Styled as
 * unverified; M3 introduces the verified/pruned visual language. The `--i` var
 * staggers the galaxy reveal.
 */
function PersonNode({ data }: NodeProps<Node<PersonNodeData>>) {
  const status = data.status ?? 'raw';
  const traceMessage = useTraceMessage(!!data.tracing);
  const style = {
    width: PERSON_NODE_WIDTH,
    '--i': data.index,
  } as CSSProperties;
  const orbStyle = { width: PERSON_ORB, height: PERSON_ORB };
  // Only a lane face links out. A raw candidate's click belongs to trace, and
  // that is the more valuable action on it.
  const orbLink = status === 'traced' ? data.profileUrl : undefined;
  const orb = (
    <>
      <Avatar dataUrl={data.photoDataUrl} name={data.name} size={PERSON_ORB} />
      {data.tracing && (
        <div className="person-orb__spinner">
          <Spinner />
        </div>
      )}
    </>
  );
  return (
    <div
      className="person-node"
      data-status={status}
      data-fresh={data.fresh ? '' : undefined}
      data-tracing={data.tracing ? '' : undefined}
      style={style}
    >
      {/* A right-edge source handle so a traced face can beam to its first
          onward leaf. Invisible (styled tiny); the cluster orbs never use it. */}
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ top: PERSON_ORB / 2 }}
      />
      <div className="person-node__pop">
        {orbLink ? (
          // A traced face: its click no longer traces (that already happened), so
          // the whole orb opens the colleague's profile, mirroring the onward leaf.
          // stopPropagation keeps React Flow's onNodeClick from firing underneath.
          <a
            className="person-orb"
            style={orbStyle}
            href={orbLink}
            target="_blank"
            rel="noopener noreferrer"
            title={t('openOnLinkedIn', data.name)}
            aria-label={t('openOnLinkedIn', data.name)}
            onClick={(e) => e.stopPropagation()}
          >
            {orb}
            <OrbOpenMark />
          </a>
        ) : (
          <div className="person-orb" style={orbStyle}>
            {orb}
          </div>
        )}
        {/* Name floats below the orb on hover only (see styles.css). A dismissed
            orb instead reveals the false-positive hint. */}
        <span className="person-node__name">
          {status === 'dismissed'
            ? t('didntWorkAt', data.companyName ?? t('here'))
            : data.name}
        </span>
        {/* While a trace runs, a caption cycles flavour messages below the orb
            so the wait reads as active (the spinner shows over the orb above). */}
        {traceMessage && (
          <span className="person-node__progress">{traceMessage}</span>
        )}
        {/* A traced colleague with no onward path: a quiet always-on caption so
            the lone face reads as intentional, not broken. */}
        {status === 'traced' && data.terminal && (
          <span className="person-node__caption">
            {t('stillAt', data.companyName ?? t('here'))}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A Level-2 onward "leaf" (m3-plan §6e): a small orb showing the company logo,
 * sitting on a colleague's lane at its join date. Never expandable
 * (no click handler). Companies reached by ≥2 colleagues carry a convergence
 * accent. Name floats in on hover, like the person orbs.
 */
function OnwardNode({ data }: NodeProps<Node<OnwardNodeData>>) {
  const style = {
    width: ONWARD_NODE_WIDTH,
    '--i': data.index,
    // Monochrome logos (black/white) sample to no hue; fall back to a muted,
    // low-luminance cool grey so they read as a quiet neutral orb and recede
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
        {data.companyUrl ? (
          // The whole orb is the link to the company's LinkedIn page; the corner
          // mark is an "opens elsewhere" hint inside it, so its overhang clicks
          // through to the same link rather than falling into the void.
          <a
            className="onward-orb"
            style={{ width: ONWARD_ORB, height: ONWARD_ORB }}
            href={data.companyUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t('openOnLinkedIn', data.name)}
            aria-label={t('openOnLinkedIn', data.name)}
            onClick={(e) => e.stopPropagation()}
          >
            <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={ONWARD_ORB} />
            <OrbOpenMark />
          </a>
        ) : (
          <div
            className="onward-orb"
            style={{ width: ONWARD_ORB, height: ONWARD_ORB }}
          >
            <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={ONWARD_ORB} />
          </div>
        )}
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

/** The galaxy heading, placed in world space between the focused orb and the
 *  people row so it stays "between the logo and the faces" as the camera moves
 *  (m2). Non-interactive: clicks pass through to the canvas. */
function GalaxyTitleNode({ data }: NodeProps<Node<GalaxyTitleData>>) {
  return (
    <div className="galaxy-title">
      <h2 className="galaxy-title__head">{t('peopleYouProbablyKnow')}</h2>
      <p className="galaxy-title__sub">
        {t('tapFaceToFollow', data.companyName ?? t('here'))}
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
      <span className="now-line__label">{t('nowLabel')}</span>
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
 * The "show more people" affordance, as the next orb in the row: a small glassy
 * orb (a dashed outline holding a facepile of blank ghost orbs) sitting just
 * past the last face, so "more here" lives where the eye already is. Click loads
 * the next page; while it loads the orb shows a spinner in place. There is no
 * count (the search pages until a load brings nobody new), so it says "more
 * people", not a number.
 *
 * `--i` is its slot in the people row (after the last face), so it staggers in
 * as the LAST orb of the reveal rather than popping in immediately.
 */
export type LoadMoreData = {
  index?: number;
  /** A page is in flight: the dots give way to a spinner in place. */
  loading?: boolean;
  /** The search is spent: the orb dims to a terminator and stops responding.
   *  Clicks are ignored in CareerGraph's onNodeClick, not here, so the whole
   *  paging flow stays in one place. */
  exhausted?: boolean;
};

function LoadMoreNode({ data }: NodeProps<Node<LoadMoreData>>) {
  const { loading = false, exhausted = false } = data;
  return (
    <div
      className="loadmore-node"
      data-state={exhausted ? 'spent' : loading ? 'loading' : undefined}
      style={{ width: PERSON_NODE_WIDTH, '--i': data.index ?? 0 } as CSSProperties}
      title={
        exhausted
          ? t('loadMoreTitleExhausted')
          : loading
            ? t('loadMoreTitleLoading')
            : t('loadMoreTitleDefault')
      }
    >
      <div
        className="loadmore-orb"
        style={{ width: PERSON_ORB, height: PERSON_ORB }}
      >
        {loading ? (
          <Spinner />
        ) : (
          // A facepile of blank orbs: two peeking out from behind a front one.
          // It says "more faces behind these" by echoing the cluster it extends,
          // where an ellipsis only borrowed a text-UI glyph for "menu" or
          // "truncated". Spent, the two behind fade off and one faint disc is
          // left: the stack has nothing more in it.
          <span className="loadmore-faces" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      {/* Always on, unlike the faces' hover-only name chips. This is a control,
          not a face: at rest it has to say what it does, and the glyph alone
          cannot carry "people". It also carries the state: the spinner says
          something is happening, the label says what. Loading is checked first
          so a click mid-flight never reads as already spent. */}
      <span className="loadmore-node__label">
        {loading
          ? t('loadMoreLabelLoading')
          : exhausted
            ? t('loadMoreLabelExhausted')
            : t('loadMoreLabelDefault')}
      </span>
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
