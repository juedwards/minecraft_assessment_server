"""Small helper to decode a compact chunk data string and write a compact
binary sample plus a small summary.

Usage: python server/scripts/decode_chunk_sample.py

This is intended as a developer helper to inspect incoming chunk payloads.
"""
import sys
import os
# Add repo root to sys.path to allow importing the server package when running as a script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from server import chunk_store

# Sample data string provided by the user
SAMPLE = '"TaRoRg*2,LEFYRg*2,P4ZVRQ,TaRoRQ,3,M0xmRg,3,TaRoRA,JDVIRQ,LEFYRQ,P4ZVRA,13,0*1,7,RYVXRQ,VKNqRQ,3,7,20,3*1,13*1,11,14,11,14,6,RYVXPQ,RYVXQA,RYVXQw,3*1,20*1,19,13,jMnVRg,13,11,M0xmRQ,11*1,9,W6FsPQ,VKNqPw,RYVXQg,3,19,20*1,13*3,11,14,11,AGoARQ,3,49,50,VKNqQQ,42,9,13*5,VKNqRA*3,3,8k4NPQ,W6FsPw,67,JDVIRA,12,W6FsRA,13*2,IHQ6Rg,13,45,13,Yr17RQ,76,W6FsRg,art+RQ,S4RZPg,W6FsQA,51,GV4vRg*2,13,90,PmZ7Rg,90,13*1,RYVXRA,86,W6FsRQ*1,W6FsPg,99,HV0wRg,GVAqRg,FlEpRg*1,116,S4RZRQ,H2MzRg,12,13,S4RZRA,86,S4RZQw,125,13,114,82,117*1,106,118,117,86,12,13,112,86,127,W6FsQw,45,125,45*1,117,HFAqRg*2,117,13,86,149,IFwxRg,JFwyRg,143,LEFYRA,Yp9vRQ,45,106,13,12,149,H08rRg*2,86,157,166*2,157,S4RZQg,9,160,3,13*1,12,13,12,13,86,Ik4sRg*1,106,166*1,W6FsQg,3,160,UIJaRQ,13*1,86,125,86,125,143,186*4,191,3*1,160*1,112,86*4,84,186*1,JU4tRg,JDVIQw,191,194,160*3,97,86,Yp9vRA*3,UIJaQw*1,84,UIJaQg,M0xmQw,160*5,crmARQ,231*3,Yp9vQw*1,235,Yp9vQg,238"'

OUT_BIN = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'sample_chunk.bin')


def main():
    try:
        pixels, heights = chunk_store.decode_getchunkdata(SAMPLE)
    except Exception as e:
        print('Decoding failed:', e)
        raise

    print('Decoded pixels:', len(pixels))
    print('Decoded heights:', len(heights))
    # basic stats
    unique_colors = len(set(pixels))
    min_h = min(heights) if heights else None
    max_h = max(heights) if heights else None
    print('unique colors:', unique_colors)
    print('height range:', min_h, max_h)

    # write a compact binary blob for inspection/use by optimized clients
    try:
        blob = chunk_store.pack_chunk_binary(pixels, heights)
        with open(OUT_BIN, 'wb') as fh:
            fh.write(blob)
        print('Wrote binary chunk to', OUT_BIN)
    except Exception as e:
        print('Failed to write binary chunk:', e)


if __name__ == '__main__':
    main()
