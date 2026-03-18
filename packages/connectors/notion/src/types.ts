/**
 * Notion API response types — minimal subset needed by the connector.
 * Using raw fetch, so we define our own types instead of importing the SDK.
 */

export interface RichText {
  type: "text" | "mention" | "equation";
  plain_text: string;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  };
  href: string | null;
  text?: { content: string; link: { url: string } | null };
}

export interface NotionPage {
  id: string;
  object: "page";
  url: string;
  archived: boolean;
  created_time: string;
  last_edited_time: string;
  created_by: { id: string };
  last_edited_by: { id: string };
  icon: { type: string; emoji?: string; external?: { url: string } } | null;
  cover: { type: string; external?: { url: string }; file?: { url: string } } | null;
  parent:
    | { type: "database_id"; database_id: string }
    | { type: "page_id"; page_id: string }
    | { type: "workspace"; workspace: true };
  properties: Record<string, NotionProperty>;
}

export interface NotionProperty {
  id: string;
  type: string;
  title?: RichText[];
  rich_text?: RichText[];
  select?: { name: string; color: string } | null;
  multi_select?: Array<{ name: string; color: string }>;
  status?: { name: string; color: string } | null;
  date?: { start: string; end: string | null } | null;
  number?: number | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  people?: Array<{ id: string; name?: string }>;
  relation?: Array<{ id: string }>;
  formula?: { type: string; string?: string; number?: number; boolean?: boolean };
  rollup?: { type: string; array?: unknown[] };
  created_time?: string;
  last_edited_time?: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  archived: boolean;
  paragraph?: { rich_text: RichText[]; color: string };
  heading_1?: { rich_text: RichText[]; is_toggleable: boolean };
  heading_2?: { rich_text: RichText[]; is_toggleable: boolean };
  heading_3?: { rich_text: RichText[]; is_toggleable: boolean };
  bulleted_list_item?: { rich_text: RichText[]; children?: NotionBlock[] };
  numbered_list_item?: { rich_text: RichText[]; children?: NotionBlock[] };
  to_do?: { rich_text: RichText[]; checked: boolean };
  toggle?: { rich_text: RichText[]; children?: NotionBlock[] };
  code?: { rich_text: RichText[]; language: string; caption: RichText[] };
  quote?: { rich_text: RichText[] };
  callout?: { rich_text: RichText[]; icon?: { emoji?: string } };
  divider?: Record<string, never>;
  image?: { type: string; file?: { url: string }; external?: { url: string }; caption: RichText[] };
  bookmark?: { url: string; caption: RichText[] };
  embed?: { url: string; caption: RichText[] };
  equation?: { expression: string };
  table?: { has_column_header: boolean; has_row_header: boolean };
  table_row?: { cells: RichText[][] };
  child_page?: { title: string };
  child_database?: { title: string };
}

export interface NotionDatabase {
  id: string;
  object: "database";
  title: RichText[];
  url: string;
}

export interface PaginatedResponse<T> {
  object: "list";
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface SearchResponse extends PaginatedResponse<NotionPage | NotionDatabase> {}
export interface QueryResponse extends PaginatedResponse<NotionPage> {}
export interface BlockChildrenResponse extends PaginatedResponse<NotionBlock> {}
