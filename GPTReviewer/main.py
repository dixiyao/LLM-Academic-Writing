import io
import xml.etree.ElementTree as ET
import base64
import os

import pdf2image
import gradio as gr
import openai
import tiktoken

def get_conference_name(root):
    conference = root.find(".//conference-title")
    if conference is not None:
        title_text = conference.text
        return title_text
    else:
        return "Conference Name"  # not found

def get_review_template(root):
    review_template = root.find(".//review-template")
    if review_template is not None:
        return review_template.text
    else:
        return "Review Template"  # not found

class ConferenceGPT4Wrapper:
    def __init__(self, openaikey,review_template,model_name="gpt-4-turbo",) -> None:
        self.model_name = model_name
        self.tokenizer = tiktoken.encoding_for_model(self.model_name)
        openai.api_key = openaikey
        review_template = io.BytesIO(review_template)
        tree = ET.parse(review_template)
        root = tree.getroot()
        self.conference_name=get_conference_name(root)
        self.review_template=get_review_template(root)

    def make_final_query_args(self, user_str, title,n_query=1):
        
        system_prompt=f"""Your task now is to draft a high-quality review outline for a top-tier conference {self.conference_name} for a submission titled "{title}":
        ======
        Your task:
        Compose a high-quality peer review of paper.

        {self.review_template}

        Be thoughtful and constructive. Write Outlines only.
        ======

        """
        query_args = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "system",
                    "content": "You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.",
                },
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {"role": "user", "content": user_str},
            ],
            "n": n_query,
        }
        return query_args

    def send_query(self, user_str, title,n_query=1):
        #print(f"# tokens sent to GPT: {len(self.tokenizer.encode(user_str))}")
        query_args = self.make_final_query_args(user_str, title,n_query)
        completion=openai.chat.completions.create(**query_args)
        result = completion.choices[0].message.content
        return result

def truncate(input_text: str, max_tokens: int, wrapper) -> str:
    truncated_text = wrapper.tokenizer.decode(
        wrapper.tokenizer.encode(input_text)[:max_tokens]
    )
    # Add back the closing ``` if it was truncated
    if not truncated_text.endswith("```"):
        truncated_text += "\n```"
    return truncated_text


def process(paper,review_template,openaikey,images=None):
    if review_template is None:
        return "Review template not uploaded. Please try again."
    wrapper = ConferenceGPT4Wrapper(openaikey=openaikey ,model_name="gpt-4-turbo",review_template=review_template)
    paper=paper.decode("utf-8")
    title_start=paper.find("\\title{")+len("\\title{")
    title_end=title_start
    while True:
        if paper[title_end]=="}":
            break
        title_end+=1
    title=paper[title_start:title_end]
    abstract=paper[paper.find("\\begin{abstract}")+len("\\begin{abstract}"):paper.find("\\end{abstract}")]
    introduction_start=paper.find("\section{Introduction}")+len("\section{Introduction}")
    introduction_end=introduction_start+paper[introduction_start:].find("\section{")
    introduction=paper[introduction_start:introduction_end]
    contents=paper[introduction_start-len("\section{Introduction}"):paper.find("\\bibliographystyle")]
    
    text_to_send = f"""
                        This is the paper in the structured contents and figures will be followed:
                        The title is {title}, the abstract is {abstract}, and the introduction is {introduction}. 
                        The contents are {contents}.
                        """
    content_to_send=[{"type":"text","text":text_to_send}]
    if images is not None:
        for image in images:
            file_type=image.split(".")[-1]
            if file_type not in ["jpg","jpeg","png","pdf"]:
                gr.Warning(f"{image.split('/')[-1]} is not a valid image file (['png','jpg','pdf','gif','webp']). Skipping.")
                continue
            if os.path.getsize(image) > 20*1024*1024:
                gr.Warning(f"{image.split('/')[-1]} is too large (>20MB). Skipping.")
                continue
            if file_type=="jpg":
                file_type="jpeg"
            if file_type=="pdf":
                page=pdf2image.convert_from_path(image,first_page=1,last_page=1)[0]
                buffer = io.BytesIO()
                page.save(buffer, format='JPEG')
                imagebase64=base64.b64encode(buffer.getvalue()).decode()
                file_type="jpeg"
            else: 
                with open(image,"rb") as file:
                    imagebase64=base64.b64encode(file.read()).decode()
            content_to_send.append({"type":"image_url","image_url":{"url":f"data:image/{file_type};base64,{imagebase64}"}})
    review_generated = wrapper.send_query(content_to_send, title,n_query=1)
    if review_generated == "":
        return "No review generated. Please try again."

    return review_generated


def main():
    with gr.Blocks(theme=gr.themes.Default(primary_hue="blue", secondary_hue="pink")) as demo:
        with gr.Row():
            with gr.Column():
                with gr.Row():
                    upload_component = gr.File(label="Upload Latex File (all in one)", type="binary")
                    upload_review_template=gr.File(label="Upload Review Template. (You can use the review templates from conferences)", type="binary")
                upload_images=gr.File(label="Upload multiple images", file_count="multiple",file_types=["image","pdf"])
                openai_key=gr.Textbox(label="OpenAI Key")
                with gr.Row():
                    gr.ClearButton([upload_component,upload_review_template,openai_key],"Clear")
                    review_generate=gr.Button("Generate Review",)

            with gr.Column():
                output_component_review = gr.Textbox(label="Review Generated. (It takes time to generate the review. Please be patient.)")
                

            review_generate.click(
                fn=process, inputs=[upload_component,upload_review_template,openai_key,upload_images], outputs=output_component_review
            )
    demo.launch(server_name="0.0.0.0", server_port=7799)


if __name__ == "__main__":
    main()