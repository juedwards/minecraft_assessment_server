import sys, os
# Ensure repo root is on sys.path so the `server` package can be imported when running this script directly
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import unittest
from server import chunk_store

SAMPLE = '"TaRoRg*2,LEFYRg*2,P4ZVRQ,TaRoRQ,3,M0xmRg,3,TaRoRA,JDVIRQ,LEFYRQ,P4ZVRA,13,0*1,7,RYVXRQ,VKNqRQ,3,7,20,3*1,13*1,11,14,11,14,6,RYVXPQ,RYVXQA,RYVXQw,3*1,20*1,19,13,jMnVRg,13,11,M0xmRQ,11*1,9,W6FsPQ,VKNqPw,RYVXQg,3,19,20*1,13*3,11,14,11,AGoARQ,3,49,50,VKNqQQ,42,9,13*5,VKNqRA*3,3,8k4NPQ,W6FsPw,67,JDVIRA,12,W6FsRA,13*2,IHQ6Rg,13,45,13,Yr17RQ,76,W6FsRg,art+RQ,S4RZPg,W6FsQA,51,GV4vRg*2,13,90,PmZ7Rg,90,13*1,RYVXRA,86,W6FsRQ*1,W6FsPg,99,HV0wRg,GVAqRg,FlEpRg*1,116,S4RZRQ,H2MzRg,12,13,S4RZRA,86,S4RZQw,125,13,114,82,117*1,106,118,117,86,12,13,112,86,127,W6FsQw,45,125,45*1,117,HFAqRg*2,117,13,86,149,IFwxRg,JFwyRg,143,LEFYRA,Yp9vRQ,45,106,13,12,149,H08rRg*2,86,157,166*2,157,S4RZQg,9,160,3,13*1,12,13,12,13,86,Ik4sRg*1,106,166*1,W6FsQg,3,160,UIJaRQ,13*1,86,125,86,125,143,186*4,191,3*1,160*1,112,86*4,84,186*1,JU4tRg,JDVIQw,191,194,160*3,97,86,Yp9vRA*3,UIJaQw*1,84,UIJaQg,M0xmQw,160*5,crmARQ,231*3,Yp9vQw*1,235,Yp9vQg,238"'

class TestChunkDecode(unittest.TestCase):
    def test_decode_length(self):
        pixels, heights = chunk_store.decode_getchunkdata(SAMPLE)
        # should decode to a 16x16 chunk
        self.assertEqual(len(pixels), 256)
        self.assertEqual(len(heights), 256)
        # validate pixel values are ints and alpha is 0xFF
        self.assertTrue(all(isinstance(p, int) for p in pixels))
        self.assertTrue(all(((p >> 24) & 0xFF) == 0xFF for p in pixels))
        # heights in 0..255
        self.assertTrue(all(0 <= h <= 255 for h in heights))

    def test_invalid_base64_token_raises(self):
        bad = '"XXXXXX"'
        with self.assertRaises(ValueError):
            chunk_store.decode_getchunkdata(bad)

    def test_reference_to_unknown_index_raises(self):
        # '5' as first token references index 5 which does not exist yet
        bad_ref = '"5"'
        with self.assertRaises(IndexError):
            chunk_store.decode_getchunkdata(bad_ref)

    def test_assemble_slices_to_voxels(self):
        # use the same sample twice as two slices
        payloads = [SAMPLE, SAMPLE]
        offsets = [0, 16]
        mapping = chunk_store.assemble_slices_to_voxels(payloads, offsets)
        self.assertIn(0, mapping)
        self.assertIn(16, mapping)
        self.assertEqual(len(mapping[0]['pixels']), 256)
        self.assertEqual(len(mapping[16]['heights']), 256)

    def test_pack_unpack_roundtrip(self):
        pixels, heights = chunk_store.decode_getchunkdata(SAMPLE)
        blob = chunk_store.pack_chunk_binary(pixels, heights)
        out = chunk_store.unpack_chunk_binary(blob)
        self.assertEqual(out['pixels'], pixels)
        self.assertEqual(out['heights'], heights)

    def test_assemble_chunk_column_stacks(self):
        pixels, heights = chunk_store.decode_getchunkdata(SAMPLE)
        # store two different slices for the same chunk coords with different y
        chunk_store.store_chunk('overworld', 0, 0, pixels, heights, y=10, request_id='r1')
        chunk_store.store_chunk('overworld', 0, 0, pixels, heights, y=20, request_id='r2')
        stacks = chunk_store.assemble_chunk_column_stacks('overworld', 0, 0)
        # every column should have at least two reported tops (one per slice)
        counts = [len(stacks[i]) for i in range(256)]
        self.assertTrue(all(c >= 2 for c in counts))

if __name__ == '__main__':
    unittest.main()
