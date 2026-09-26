import { orderableDocumentListDeskItem } from "@sanity/orderable-document-list";
import {
  BookMarked,
  Cog,
  File,
  FileText,
  House,
  type LucideIcon,
  Mail,
  MessageCircle,
  PanelBottom,
  PanelTop,
  Settings2,
  TrendingUpDown,
  User,
} from "lucide-react";
import type {
  DefaultDocumentNodeResolver,
  StructureBuilder,
  StructureResolverContext,
} from "sanity/structure";

import { createSlugBasedStructure } from "@/components/nested-pages-structure";
import { SeoIndexView } from "@/components/seo-index-view";
import type { SchemaType, SingletonType } from "@/schemaTypes/index";
import { getTitleCase } from "@/utils/helper";

type Base<T = SchemaType> = {
  id?: string;
  type: T;
  preview?: boolean;
  title?: string;
  icon?: LucideIcon;
};

type CreateSingleTon = {
  S: StructureBuilder;
} & Base<SingletonType>;

const createSingleTon = ({ S, type, title, icon }: CreateSingleTon) => {
  const newTitle = title ?? getTitleCase(type);
  return S.listItem()
    .title(newTitle)
    .icon(icon ?? File)
    .child(S.document().schemaType(type).documentId(type));
};

type CreateList = {
  S: StructureBuilder;
} & Base;

const createList = ({ S, type, icon, title, id }: CreateList) => {
  const newTitle = title ?? getTitleCase(type);
  return S.documentTypeListItem(type)
    .id(id ?? type)
    .title(newTitle)
    .icon(icon ?? File);
};

type CreateIndexList = {
  S: StructureBuilder;
  list: Base;
  index: Base<SingletonType>;
  context: StructureResolverContext;
};

const createIndexListWithOrderableItems = ({
  S,
  index,
  list,
  context,
}: CreateIndexList) => {
  const indexTitle = index.title ?? getTitleCase(index.type);
  const listTitle = list.title ?? getTitleCase(list.type);
  return S.listItem()
    .title(listTitle)
    .icon(index.icon ?? File)
    .child(
      S.list()
        .title(indexTitle)
        .items([
          S.listItem()
            .title(indexTitle)
            .icon(index.icon ?? File)
            .child(
              S.document()
                .views([S.view.form()])
                .schemaType(index.type)
                .documentId(index.type)
            ),
          orderableDocumentListDeskItem({
            type: list.type,
            S,
            context,
            icon: list.icon ?? File,
            title: `${listTitle}`,
          }),
        ])
    );
};

/**
 * Views for a document opened from any list. Blog posts get a second,
 * read-only "SEO & Index" tab beside the editor; every other type keeps the
 * form alone. The blogIndex singleton declares its own views above and is
 * not affected.
 */
export const defaultDocumentNode: DefaultDocumentNodeResolver = (
  S,
  { schemaType }
) =>
  schemaType === "blog"
    ? S.document().views([
        S.view.form(),
        S.view.component(SeoIndexView).title("SEO & Index"),
      ])
    : S.document().views([S.view.form()]);

export const structure = (
  S: StructureBuilder,
  context: StructureResolverContext
) =>
  S.list()
    .title("Content")
    .items([
      createSingleTon({ S, type: "homePage", icon: House }),
      S.divider(),
      createSlugBasedStructure(S, "page"),
      createIndexListWithOrderableItems({
        S,
        index: { type: "blogIndex", icon: BookMarked },
        list: { type: "blog", title: "Blogs", icon: FileText },
        context,
      }),
      createList({
        S,
        type: "faq",
        title: "FAQs",
        icon: MessageCircle,
      }),
      createList({ S, type: "author", title: "Authors", icon: User }),
      createList({ S, type: "subscriber", title: "Subscribers", icon: Mail }),
      createList({
        S,
        type: "redirect",
        title: "Redirects",
        icon: TrendingUpDown,
      }),
      S.divider(),
      S.listItem()
        .title("Site Configuration")
        .icon(Settings2)
        .child(
          S.list()
            .title("Site Configuration")
            .items([
              createSingleTon({
                S,
                type: "navbar",
                title: "Navigation",
                icon: PanelTop,
              }),
              createSingleTon({
                S,
                type: "footer",
                title: "Footer",
                icon: PanelBottom,
              }),
              createSingleTon({
                S,
                type: "settings",
                title: "Global Settings",
                icon: Cog,
              }),
            ])
        ),
    ]);
