import { Mail } from "lucide-react";
import { defineField, defineType } from "sanity";

export const subscriber = defineType({
  name: "subscriber",
  type: "document",
  title: "Subscriber",
  description:
    "Someone who signed up to the newsletter through the form on the website.",
  icon: Mail,
  fields: [
    defineField({
      name: "email",
      type: "string",
      title: "Email",
      description: "The email address entered in the newsletter form",
      validation: (Rule) => Rule.required().email(),
    }),
    defineField({
      name: "subscribedAt",
      type: "datetime",
      title: "Subscribed At",
      description: "When the signup happened. Set by the website, not by hand.",
      readOnly: true,
    }),
  ],
  preview: {
    select: { title: "email", subtitle: "subscribedAt" },
    prepare: ({ title, subtitle }) => ({
      title: title || "No email",
      subtitle: subtitle ? new Date(subtitle).toLocaleString() : "",
    }),
  },
});
