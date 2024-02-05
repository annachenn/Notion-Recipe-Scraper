require("dotenv").config();
const prompt = require("prompt-sync")();
const axios = require("axios");
const cheerio = require("cheerio");
const { Client } = require("@notionhq/client");

const searchAPIKey = "AIzaSyBVd0dQsieIxGR6k9rP5cqfMuiWWRrZ3Fc";
const cx = "31595be04bb5e4589"; // Custom Search Engine ID
const notion = new Client({ auth: process.env.NOTION_KEY });

let pageLink = prompt("What is the Notion database page URL? ");

getURL(pageLink);

async function getURL(pageLink) {
  const pageId = pageLink?.split("/")[3]?.split("?")[0]?.split("-")?.pop();
  const response = await notion.pages.retrieve({ page_id: pageId });
  const url = response.properties.Link.url;

  getRecipeData(url, pageId);

  try {
    if (!response)
      throw "Invalid database page link. Are you sure the page exists?";
    if (!url) throw "There doesn't appear to be a valid link on that page.";
  } catch (err) {
    console.log("Error: ", err);
  }
}

async function getRecipeData(url, pageId) {
  if (url.length && pageId.length) {
    console.log("Inputs received, scraping website data...");
  } else {
    console.log("Invalid inputs, exiting.");
    return;
  }

  // Download target url
  const axiosResponse = await axios.request({
    method: "GET",
    url: url,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    },
  });

  // parsing the HTML source of the target web page with Cheerio
  const $ = cheerio.load(axiosResponse.data);

  // Data fields
  const title = $("h1").text();
  const coverImg =
    (await searchImage(url)) ||
    "https://www.w3schools.com/css/img_mountains.jpg";
  const servings = Number($("[data-servings]").attr("data-servings"));
  const ingredients = getRecipeContent($, ["ingredients"]);
  const instructionsSynonyms = ["instructions", "method", "preparation"];
  const instructions = getRecipeContent($, instructionsSynonyms);

  const recipeData = {
    url,
    title,
    coverImg,
    servings,
    ingredients,
    instructions,
  };

  updatePage(recipeData, pageId);
}

async function updatePage(recipeData, pageId) {
  const response = await notion.pages.update({
    page_id: pageId,
    cover: {
      "type": "external",
      "external": {
        "url": recipeData.coverImg,
      },
    },
    properties: {
      "Link": {
        "url": recipeData.url,
      },
      "Servings": {
        "number": recipeData.servings,
      },
      "Name": {
        "title": [
          {
            "type": "text",
            "text": {
              "content": recipeData.title,
            },
          },
        ],
      },
    },
  });

  const responseBlock = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        "object": "block",
        "type": "column_list",
        "column_list": {
          "children": [
            // Column 1: ingredients
            {
              "object": "block",
              "type": "column",
              "column": {
                "children": [
                  // Header
                  {
                    "heading_1": {
                      "rich_text": [
                        {
                          "text": {
                            "content": "🍌 Ingredients",
                          },
                        },
                      ],
                    },
                  },
                  // Ingredients list
                  ...recipeData.ingredients.map((item) => ({
                    "bulleted_list_item": {
                      "rich_text": [
                        {
                          "type": "text",
                          "text": {
                            "content": item,
                          },
                        },
                      ],
                    },
                  })),
                ],
              },
            },

            // Column 2: Instructions
            {
              "object": "block",
              "type": "column",
              "column": {
                "children": [
                  // Header
                  {
                    "heading_1": {
                      "rich_text": [
                        {
                          "text": {
                            "content": "🥘 Instructions",
                          },
                        },
                      ],
                    },
                  },
                  // Instructions list
                  ...recipeData.instructions.map((item) => ({
                    "numbered_list_item": {
                      "rich_text": [
                        {
                          "type": "text",
                          "text": {
                            "content": item,
                          },
                        },
                      ],
                    },
                  })),
                ],
              },
            },
          ],
        },
      },
    ],
  });

  console.log(recipeData);
  console.log(response, responseBlock);
  console.log(`Operation complete.`);
}

async function searchImage(query) {
  const apiUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(
    query
  )}&key=${searchAPIKey}&cx=${cx}&searchType=image`;

  try {
    const response = await axios.get(apiUrl);

    const results = response.data.items
      .filter((item) => item.link.endsWith(".jpg" || ".png")) // only get image files
      .map((item) => ({
        url: item.link,
        width: item.image.width,
      }));
    const image = getLargestImage(results);

    return image;
  } catch (error) {
    console.error("Error searching for images:", error.message);
    throw error;
  }
}

function getLargestImage(images) {
  const widths = images.map((item) => item.width);
  const widest = Math.max(...widths);
  const largestImage = images[widths.indexOf(widest)];

  return largestImage.url;
}

function getRecipeContent($, target) {
  const content = [];

  const container = $("h2, h3")
    .filter((index, element) => {
      return target.some((substr) =>
        $(element).text().toLowerCase().startsWith(substr)
      );
    })
    .siblings("div, ul, ol");

  container.find("li").each((index, element) => {
    content.push(
      $(element)
        .text()
        .replace(/▢/g, "") // remove unicode
        .replace(/\s+/g, " ") // remove double spcaes
        .trim()
    );
  });

  return content;
}
